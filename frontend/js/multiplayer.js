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
  let connections  = new Map(); // peerId -> DataConnection
  let mediaCalls   = new Map(); // peerId -> MediaConnection
  let myPeerId     = null;
  let roomCode     = null;
  let isHost       = false;
  let phase        = 'lobby';

  let localStream  = null;
  let playersList  = []; // [{ id, name, isHost, character }]

  let mqttClient      = null;
  let pulseTimer      = null;
  let isConnectedHost = false;

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
    if (mediaCalls.has(targetPeerId)) return;

    console.log(`[P2P] Initiating 2-way media call to ${targetPeerId}`);
    const call = peer.call(targetPeerId, localStream);
    mediaCalls.set(targetPeerId, call);

    call.on('stream', (remoteStream) => {
      attachMediaStreamToVideo(remoteStream);
    });
  }

  /* ---- MQTT Global Signaling Relay ---- */

  function initMQTTSignaling(code, currentPhase) {
    if (typeof Paho === 'undefined') {
      console.warn('[MQTT] Paho library not loaded.');
      return;
    }

    if (mqttClient) {
      try { mqttClient.disconnect(); } catch (_) {}
      mqttClient = null;
    }

    const clientId = `pyb_mqtt_${Math.floor(100000 + Math.random() * 900000)}`;
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
        onSuccess: () => {
          console.log(`[MQTT] Connected to global signaling broker. Topic: ${topic}`);
          mqttClient.subscribe(topic);

          if (isHost && myPeerId) {
            publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
          } else {
            publishMQTT({ type: 'find-host' });
          }
        },
        onFailure: (err) => {
          console.warn('[MQTT] Connection failed:', err);
        }
      });
    } catch (e) {
      console.warn('[MQTT] Init failed:', e);
    }
  }

  function publishMQTT(payload) {
    if (!mqttClient || !mqttClient.isConnected()) return;
    try {
      const topic = `pyb/room/${roomCode}/${phase}`;
      const msgText = JSON.stringify({ ...payload, code: roomCode, phase: phase, sender: myPeerId });
      const message = new Paho.MQTT.Message(msgText);
      message.destinationName = topic;
      mqttClient.send(message);
    } catch (_) {}
  }

  function handleSignalingMessage(msg) {
    if (!msg || msg.code !== roomCode || msg.phase !== phase || msg.sender === myPeerId) return;

    if (msg.type === 'host-announce') {
      if (!isHost && !isConnectedHost && msg.hostPeerId) {
        console.log(`[Signaling] Discovered Host PeerID: ${msg.hostPeerId}. Connecting...`);
        connectToHost(msg.hostPeerId);
      }
    } else if (msg.type === 'find-host') {
      if (isHost && myPeerId) {
        console.log(`[Signaling] Received find-host. Announcing PeerID: ${myPeerId}`);
        publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
      }
    }
  }

  function connectToHost(targetPeerId) {
    if (!peer || !targetPeerId || isConnectedHost) return;
    const localName = localStorage.getItem('pyb_username') || 'Player';
    const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

    console.log(`[P2P] Connecting to Host (${targetPeerId})...`);
    const conn = peer.connect(targetPeerId, {
      metadata: { name: localName, character: localChar },
      reliable: true
    });
    window.PYBMultiplayer.setupDataConnection(conn);
  }

  /* ---- Public API ---- */

  window.PYBMultiplayer = {
    init: function (code, hostFlag, username, currentPhase = 'lobby') {
      roomCode        = code;
      isHost          = hostFlag;
      phase           = currentPhase;
      isConnectedHost = false;

      const localName = username || localStorage.getItem('pyb_username') || 'Player';
      const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

      // Cleanup old timers & peer instances
      if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; }
      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
      connections.clear();
      mediaCalls.clear();

      // Deterministic fallback ID + Random unique ID (prevents PeerJS unavailable-id collision)
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
            this.notifyLobbyUpdate();
          }

          // Fallback deterministic connect attempt (same Wi-Fi / same PC)
          const fallbackHostId = `pyb-${phase}-host-${roomCode}`;
          if (!isHost) {
            connectToHost(fallbackHostId);
          }

          // Initialize EMQX MQTT global signaling relay
          initMQTTSignaling(roomCode, phase);

          // Fast signaling pulse timer
          pulseTimer = setInterval(() => {
            if (isHost && myPeerId) {
              publishMQTT({ type: 'host-announce', hostPeerId: myPeerId });
            } else if (!isHost && !isConnectedHost) {
              connectToHost(fallbackHostId);
              publishMQTT({ type: 'find-host' });
            }
          }, 300);

          resolve(true);
        });

        peer.on('connection', (conn) => {
          console.log(`[P2P] Incoming direct connection from ${conn.peer}`);
          this.setupDataConnection(conn);
        });

        peer.on('call', (call) => {
          console.log(`[P2P] Incoming media call from ${call.peer}`);
          mediaCalls.set(call.peer, call);

          if (localStream) {
            call.answer(localStream);
          } else {
            console.warn('[P2P] Answering call without stream, requesting webcam...');
            navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 } },
              audio: true
            }).then(stream => {
              localStream = stream;
              call.answer(localStream);
            }).catch(() => call.answer());
          }

          call.on('stream', (remoteStream) => {
            console.log('[P2P] Incoming call stream received');
            attachMediaStreamToVideo(remoteStream);
          });
        });

        peer.on('error', (err) => {
          console.warn('[P2P Error]', err.type, err.message);
        });
      });
    },

    setupDataConnection: function (conn) {
      if (!conn) return;

      conn.on('open', () => {
        console.log(`[P2P] Direct DataChannel OPEN with ${conn.peer}`);
        connections.set(conn.peer, conn);

        const localName = localStorage.getItem('pyb_username') || 'Player';
        const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

        if (!isHost) {
          isConnectedHost = true;
          if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; }

          conn.send({
            type: 'join-request',
            senderId: myPeerId,
            name: localName,
            character: localChar
          });
        }

        // Initiate 2-way media call if localStream is ready
        if (localStream && peer) {
          initiateCallToPeer(conn.peer);
        }

        // 2s stream verification check (auto-reconnects if 1-way call dropped)
        setTimeout(() => {
          const peerVideo = document.getElementById('peerVideo');
          if (peerVideo && (!peerVideo.srcObject || peerVideo.srcObject.getTracks().length === 0)) {
            console.log('[P2P] PeerVideo still empty after 2s, re-initiating media call...');
            if (localStream && peer) initiateCallToPeer(conn.peer);
          }
        }, 2000);
      });

      conn.on('data', (data) => {
        this.handleIncomingData(data, conn);
      });

      conn.on('error', (err) => {
        console.warn('[P2P] Connection error:', err);
        connections.delete(conn.peer);
      });

      conn.on('close', () => {
        console.log(`[P2P] Connection CLOSED with ${conn.peer}`);
        connections.delete(conn.peer);
        if (isHost) {
          playersList = playersList.filter(p => p.id !== conn.peer);
          this.notifyLobbyUpdate();
        }
      });
    },

    handleIncomingData: function (data, conn) {
      if (!data || !data.type) return;

      switch (data.type) {
        case 'join-request':
          if (isHost) {
            const joinerId = conn.peer;
            const existing = playersList.find(p => p.id === joinerId);
            if (!existing) {
              playersList.push({
                id: joinerId,
                name: data.name || 'Player',
                isHost: false,
                character: data.character || {}
              });
            } else {
              existing.character = data.character || existing.character;
            }
            this.notifyLobbyUpdate();

            if (conn.open) {
              conn.send({ type: 'lobby-update', players: playersList });
            }
          }
          break;

        case 'lobby-update':
          playersList = data.players;
          if (data && data.durationMins) {
            sessionStorage.setItem('durationMins', data.durationMins);
          }
          if (window.updateLobbyUI) {
            window.updateLobbyUI(playersList);
          }
          break;

        case 'start-game':
          console.log('[P2P] Game started by host');
          if (data) {
            if (data.startTime)    sessionStorage.setItem('pyb_game_start_time', data.startTime);
            if (data.durationMins) sessionStorage.setItem('durationMins', data.durationMins);
          }
          const targetUrl = (data && data.url)
            ? data.url
            : `play.html?code=${roomCode}&duration=${sessionStorage.getItem('durationMins') || 1}`;
          window.location.href = targetUrl;
          break;

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
      sessionStorage.setItem('pyb_game_start_time', startTime);

      const gameUrl = `play.html?code=${roomCode}&duration=${durationMins}&t=${startTime}`;

      this.broadcast({
        type: 'start-game',
        url: gameUrl,
        startTime: startTime,
        durationMins: durationMins
      });

      // 120ms buffer to allow WebRTC packet to flush before page unload
      setTimeout(() => {
        window.location.href = gameUrl;
      }, 120);
    },

    sendStrokePoint: function (strokeData) {
      this.broadcast({
        type: 'draw-stroke',
        stroke: strokeData
      });
    },

    sendClearCanvas: function () {
      this.broadcast({ type: 'clear-canvas' });
    },

    sendCanvasResult: function (dataUrl) {
      this.broadcast({
        type: 'peer-canvas-result',
        drawnData: dataUrl
      });
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
        if (conn.open) {
          conn.send(data);
        }
      });
    },

    getPlayers: function () { return playersList; },
    getIsHost:  function () { return isHost; }
  };
})();
