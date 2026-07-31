/* Paint Ya Blud - Symmetric Dual-Channel WebRTC Engine
 *
 * Direct P2P + EMQX MQTT Signaling Relay:
 * - Host and Joiners generate unique Peer IDs (0% ID collision chance on PeerJS Cloud)
 * - EMQX MQTT Global Broker (wss://broker.emqx.io:8084/mqtt) exchanges Peer IDs instantly
 * - Direct P2P WebRTC DataChannels for drawing strokes
 * - Direct P2P WebRTC MediaStreams with STUN + TURN Relay for 2-Way camera & voice chat
 */

(function () {
  let peer = null;
  let connections     = new Map(); // peerId -> DataConnection
  let mediaCalls      = new Map(); // peerId -> MediaConnection
  let myPeerId        = null;
  let roomCode        = null;
  let isHost          = false;
  let phase           = 'lobby';

  let localStream     = null;
  let playersList     = []; // [{ id, name, isHost, character }]

  let mqttClient      = null;
  let pulseTimer      = null;
  let isConnectedHost = false;

  // Save reference to public API for use inside callbacks where `this` is unavailable
  let API = null;

  // Global ICE Servers (STUN + TURN for cross-household NAT/firewall traversal)
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  /* ---- Helper to attach 2-way media stream ---- */
  function attachMediaStreamToVideo(remoteStream) {
    if (!remoteStream) return;
    const peerVideo = document.getElementById('peerVideo');
    if (peerVideo) {
      peerVideo.srcObject = remoteStream;
      peerVideo.play().catch(() => {});
      console.log('[P2P] Remote video & voice stream active on #peerVideo ✓');
    }
  }

  function initiateCallToPeer(targetPeerId) {
    if (!peer || !localStream || !targetPeerId) return;
    if (mediaCalls.has(targetPeerId)) return; // Already calling

    console.log(`[P2P] Initiating 2-way media call to ${targetPeerId}`);
    const call = peer.call(targetPeerId, localStream);
    if (!call) return;
    mediaCalls.set(targetPeerId, call);

    call.on('stream', (remoteStream) => {
      attachMediaStreamToVideo(remoteStream);
    });

    call.on('close', () => {
      mediaCalls.delete(targetPeerId);
    });

    call.on('error', () => {
      mediaCalls.delete(targetPeerId);
    });
  }

  /* ---- MQTT Global Signaling Relay ---- */

  function initMQTTSignaling(code, currentPhase) {
    if (typeof Paho === 'undefined') {
      console.warn('[MQTT] Paho library not loaded — MQTT signaling unavailable.');
      return;
    }

    if (mqttClient) {
      try { mqttClient.disconnect(); } catch (_) {}
      mqttClient = null;
    }

    const clientId = `pyb_${Math.floor(100000 + Math.random() * 900000)}`;
    const topic    = `pyb/room/${code}/${currentPhase}`;

    try {
      mqttClient = new Paho.MQTT.Client('broker.emqx.io', 8084, clientId);

      mqttClient.onMessageArrived = (message) => {
        try {
          const data = JSON.parse(message.payloadString);
          handleSignalingMessage(data);
        } catch (_) {}
      };

      mqttClient.onConnectionLost = (err) => {
        if (err.errorCode !== 0) {
          console.warn('[MQTT] Signaling connection lost, reconnecting...', err.errorMessage);
          setTimeout(() => initMQTTSignaling(code, currentPhase), 2000);
        }
      };

      mqttClient.connect({
        useSSL: true,
        timeout: 5,
        keepAliveInterval: 30,
        onSuccess: () => {
          console.log(`[MQTT] Connected to signaling broker. Topic: ${topic}`);
          mqttClient.subscribe(topic);

          // Announce immediately on connect
          if (isHost && myPeerId) {
            publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
          } else if (!isHost) {
            publishMQTT({ type: 'find-host' });
          }
        },
        onFailure: (err) => {
          console.warn('[MQTT] Broker connection failed:', err.errorMessage);
        }
      });
    } catch (e) {
      console.warn('[MQTT] Init error:', e);
    }
  }

  function publishMQTT(payload) {
    if (!mqttClient || !mqttClient.isConnected()) return;
    try {
      const topic   = `pyb/room/${roomCode}/${phase}`;
      const msgText = JSON.stringify({ ...payload, code: roomCode, phase: phase, sender: myPeerId });
      const message = new Paho.MQTT.Message(msgText);
      message.destinationName = topic;
      mqttClient.send(message);
    } catch (_) {}
  }

  function handleSignalingMessage(msg) {
    if (!msg || msg.code !== roomCode || msg.phase !== phase) return;
    if (msg.sender === myPeerId) return; // Ignore our own messages

    if (msg.type === 'host-announce' && !isHost) {
      if (!isConnectedHost && msg.hostPeerId) {
        console.log(`[Signaling] Discovered Host PeerID via MQTT: ${msg.hostPeerId}`);
        connectToPeer(msg.hostPeerId);
      }
    } else if (msg.type === 'find-host' && isHost && myPeerId) {
      console.log('[Signaling] Received find-host request, announcing...');
      publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
    }
  }

  function connectToPeer(targetPeerId) {
    if (!peer || !targetPeerId) return;
    if (isConnectedHost) return; // Already connected to host

    const localName = localStorage.getItem('pyb_username') || 'Player';
    const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

    console.log(`[P2P] Connecting to peer (${targetPeerId})...`);
    const conn = peer.connect(targetPeerId, {
      metadata: { name: localName, character: localChar },
      reliable: true
    });
    API.setupDataConnection(conn);
  }

  /* ---- Public API ---- */

  API = {
    init: function (code, hostFlag, username, currentPhase) {
      currentPhase    = currentPhase || 'lobby';
      roomCode        = code;
      isHost          = hostFlag;
      phase           = currentPhase;
      isConnectedHost = false;

      const localName = username || localStorage.getItem('pyb_username') || 'Player';
      const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

      // Cleanup old state
      if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; }
      if (mqttClient) {
        try { mqttClient.disconnect(); } catch (_) {}
        mqttClient = null;
      }
      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
      connections.clear();
      mediaCalls.clear();

      // Every peer gets a unique random ID — eliminates PeerJS ID collision errors
      const uniqueRandom = Math.floor(100000 + Math.random() * 900000);
      const myTargetId   = `pyb-${phase}-${isHost ? 'host' : 'user'}-${uniqueRandom}`;

      return new Promise((resolve) => {
        if (!window.Peer) {
          console.warn('[Multiplayer] PeerJS library not loaded.');
          resolve(false);
          return;
        }

        peer = new Peer(myTargetId, {
          config: { iceServers: ICE_SERVERS },
          debug: 1
        });

        peer.on('open', (id) => {
          myPeerId = id;
          console.log(`[P2P] Peer ready (${phase}). My PeerID: ${id}`);

          if (isHost) {
            playersList = [{ id: myPeerId, name: localName, isHost: true, character: localChar }];
            API.notifyLobbyUpdate();
          }

          // Initialize MQTT global signaling (discovers peers across any network)
          initMQTTSignaling(roomCode, phase);

          // Pulse timer: host announces itself, joiner keeps trying to find host
          pulseTimer = setInterval(() => {
            if (isHost && myPeerId) {
              publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
            } else if (!isHost && !isConnectedHost) {
              publishMQTT({ type: 'find-host' });
            }
          }, 500);

          resolve(true);
        });

        peer.on('connection', (conn) => {
          console.log(`[P2P] Incoming connection from ${conn.peer}`);
          API.setupDataConnection(conn);
        });

        peer.on('call', (call) => {
          console.log(`[P2P] Incoming media call from ${call.peer}`);
          mediaCalls.set(call.peer, call);

          if (localStream) {
            call.answer(localStream);
          } else {
            // Request webcam and answer with stream
            navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 } },
              audio: true
            }).then((stream) => {
              localStream = stream;
              call.answer(localStream);
            }).catch(() => {
              call.answer(); // Answer without stream as last resort
            });
          }

          call.on('stream', (remoteStream) => {
            console.log('[P2P] Remote stream received from incoming call ✓');
            attachMediaStreamToVideo(remoteStream);
          });

          call.on('close', () => {
            mediaCalls.delete(call.peer);
          });
        });

        peer.on('error', (err) => {
          // 'unavailable-id' just means collision — our random IDs make this very rare
          // 'peer-unavailable' means we tried to connect to someone who isn't online yet
          // Both are non-fatal; MQTT signaling will retry
          console.warn('[P2P] Error:', err.type, '-', err.message);
        });

        peer.on('disconnected', () => {
          console.warn('[P2P] Peer disconnected from PeerJS server, reconnecting...');
          try { peer.reconnect(); } catch (_) {}
        });
      });
    },

    setupDataConnection: function (conn) {
      if (!conn) return;

      conn.on('open', () => {
        console.log(`[P2P] DataChannel OPEN with ${conn.peer}`);

        // Prevent duplicate registrations
        if (connections.has(conn.peer)) {
          console.log('[P2P] Duplicate connection, closing old one');
          try { connections.get(conn.peer).close(); } catch (_) {}
        }
        connections.set(conn.peer, conn);

        const localName = localStorage.getItem('pyb_username') || 'Player';
        const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

        if (!isHost) {
          isConnectedHost = true;
          // Stop pulse timer — we are connected
          if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; }

          conn.send({
            type: 'join-request',
            senderId: myPeerId,
            name: localName,
            character: localChar
          });
        }

        // Initiate media call if localStream is ready
        if (localStream && peer) {
          initiateCallToPeer(conn.peer);
        }

        // 2-second stream verify: auto re-call if one-way stream happened
        setTimeout(() => {
          const peerVideo = document.getElementById('peerVideo');
          const hasTracks = peerVideo && peerVideo.srcObject &&
                            peerVideo.srcObject.getTracks().length > 0;
          if (!hasTracks && localStream && peer && connections.has(conn.peer)) {
            console.log('[P2P] No peer video after 2s, re-initiating media call...');
            mediaCalls.delete(conn.peer); // Allow re-attempt
            initiateCallToPeer(conn.peer);
          }
        }, 2000);
      });

      conn.on('data', (data) => {
        API.handleIncomingData(data, conn);
      });

      conn.on('error', (err) => {
        console.warn('[P2P] DataChannel error:', err);
        connections.delete(conn.peer);
      });

      conn.on('close', () => {
        console.log(`[P2P] DataChannel CLOSED with ${conn.peer}`);
        connections.delete(conn.peer);
        mediaCalls.delete(conn.peer);

        if (isHost) {
          playersList = playersList.filter(p => p.id !== conn.peer);
          API.notifyLobbyUpdate();
        } else {
          // Joiner lost connection to host — reset and try again
          isConnectedHost = false;
        }
      });
    },

    handleIncomingData: function (data, conn) {
      if (!data || !data.type) return;

      switch (data.type) {
        case 'join-request': {
          if (!isHost) break;
          const joinerId  = conn.peer;
          const existing  = playersList.find(p => p.id === joinerId);
          if (!existing) {
            playersList.push({
              id: joinerId,
              name: data.name || 'Player',
              isHost: false,
              character: data.character || {}
            });
          } else {
            existing.name      = data.name || existing.name;
            existing.character = data.character || existing.character;
          }
          API.notifyLobbyUpdate();
          // Also send full lobby state directly back to the new joiner
          if (conn.open) {
            const durationMins = sessionStorage.getItem('durationMins') || '1';
            conn.send({ type: 'lobby-update', players: playersList, durationMins: durationMins });
          }
          break;
        }

        case 'lobby-update': {
          if (Array.isArray(data.players)) {
            playersList = data.players;
          }
          if (data.durationMins) {
            sessionStorage.setItem('durationMins', String(data.durationMins));
          }
          if (window.updateLobbyUI) {
            window.updateLobbyUI(playersList);
          }
          break;
        }

        case 'start-game': {
          console.log('[P2P] START GAME signal received from host');
          if (data.startTime)    sessionStorage.setItem('pyb_game_start_time', String(data.startTime));
          if (data.durationMins) sessionStorage.setItem('durationMins', String(data.durationMins));

          const roomCodeParam = roomCode || sessionStorage.getItem('roomCode') || '';
          const dur           = data.durationMins || sessionStorage.getItem('durationMins') || '1';
          const t             = data.startTime || Date.now();
          // Build URL with all sync parameters
          const targetUrl = data.url ||
            `play.html?code=${roomCodeParam}&duration=${dur}&t=${t}`;
          // Small delay so data flush can complete
          setTimeout(() => { window.location.href = targetUrl; }, 150);
          break;
        }

        case 'draw-stroke':
          if (window.renderRemoteStrokePoint) {
            window.renderRemoteStrokePoint(data.stroke);
          }
          break;

        case 'clear-canvas':
          if (window.clearCanvasRemote) {
            window.clearCanvasRemote();
          }
          break;

        case 'peer-canvas-result':
          if (window.onRemoteCanvasResult) {
            window.onRemoteCanvasResult(data.drawnData);
          }
          break;
      }
    },

    notifyLobbyUpdate: function () {
      const durationMins = sessionStorage.getItem('durationMins') || '1';
      if (window.updateLobbyUI) {
        window.updateLobbyUI(playersList);
      }
      this.broadcast({
        type: 'lobby-update',
        players: playersList,
        durationMins: durationMins
      });
    },

    triggerStartGame: function () {
      if (!isHost) return;

      const startTime    = Date.now();
      const durationMins = sessionStorage.getItem('durationMins') || '1';
      sessionStorage.setItem('pyb_game_start_time', String(startTime));

      const roomCodeParam = roomCode || sessionStorage.getItem('roomCode') || '';
      const gameUrl = `play.html?code=${roomCodeParam}&duration=${durationMins}&t=${startTime}`;

      this.broadcast({
        type: 'start-game',
        url: gameUrl,
        startTime: startTime,
        durationMins: durationMins
      });

      // 200ms buffer so packet flushes before this page navigates away
      setTimeout(() => {
        window.location.href = gameUrl;
      }, 200);
    },

    sendStrokePoint: function (strokeData) {
      this.broadcast({ type: 'draw-stroke', stroke: strokeData });
    },

    sendClearCanvas: function () {
      this.broadcast({ type: 'clear-canvas' });
    },

    sendCanvasResult: function (dataUrl) {
      this.broadcast({ type: 'peer-canvas-result', drawnData: dataUrl });
    },

    startVideoCall: function (stream) {
      localStream = stream;
      if (!peer) return;
      connections.forEach((conn, peerId) => {
        if (conn.open) {
          initiateCallToPeer(peerId);
        }
      });
    },

    broadcast: function (data) {
      connections.forEach((conn) => {
        if (conn && conn.open) {
          try { conn.send(data); } catch (_) {}
        }
      });
    },

    getPlayers:  function () { return playersList; },
    getIsHost:   function () { return isHost; },
    getMyPeerId: function () { return myPeerId; }
  };

  window.PYBMultiplayer = API;
})();
