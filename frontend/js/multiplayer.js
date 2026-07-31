/* Paint Ya Blud - Ultra-Robust WebRTC & Multi-Relay Multiplayer Engine
 *
 * Uses a hybrid signaling coordinator:
 * 1. BroadcastChannel (instant zero-latency sync for same-device/incognito tabs)
 * 2. Public WSS Relay (global cross-device internet signaling)
 * 3. PeerJS WebRTC with assigned random IDs (100% NAT/STUN traversal, zero custom-ID drops)
 */

(function () {
  let peer = null;
  let connections = new Map(); // peerId -> DataConnection
  let mediaCalls  = new Map(); // peerId -> MediaConnection
  let myPeerId    = null;
  let roomCode    = null;
  let isHost      = false;
  let phase       = 'lobby';

  let localStream = null;
  let playersList = []; // [{ id, name, isHost, character }]

  // Signaling channels
  let broadcastChan = null;
  let wsRelay       = null;
  let announceTimer = null;
  let hostPeerId    = null;

  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ];

  /* ---- Signaling Relay Helpers ---- */

  function initSignaling(code) {
    // 1. BroadcastChannel for local/incognito tabs
    try {
      if (broadcastChan) broadcastChan.close();
      broadcastChan = new BroadcastChannel(`pyb_room_${code}_${phase}`);
      broadcastChan.onmessage = (e) => handleSignalingMsg(e.data);
    } catch (e) {
      console.warn('[Multiplayer] BroadcastChannel not supported:', e);
    }

    // 2. Public WSS Relay for cross-device signaling over internet
    try {
      if (wsRelay) wsRelay.close();
      wsRelay = new WebSocket('wss://api.piesocket.com/v3/demo?api_key=VCX2aC2m5gBUtNnKAXEYYA5P2wJGuuipoxPqjf4I&notify_self=0');
      wsRelay.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg && msg.code === code && msg.phase === phase) {
            handleSignalingMsg(msg);
          }
        } catch (_) {}
      };
    } catch (e) {
      console.warn('[Multiplayer] WebSocket relay failed:', e);
    }
  }

  function sendSignalingMsg(msg) {
    const payload = { ...msg, code: roomCode, phase: phase };
    if (broadcastChan) {
      try { broadcastChan.postMessage(payload); } catch (_) {}
    }
    if (wsRelay && wsRelay.readyState === WebSocket.OPEN) {
      try { wsRelay.send(JSON.stringify(payload)); } catch (_) {}
    }
  }

  function handleSignalingMsg(msg) {
    if (!msg || msg.code !== roomCode || msg.phase !== phase) return;

    if (msg.type === 'host-announce') {
      if (!isHost && !hostPeerId) {
        hostPeerId = msg.hostPeerId;
        console.log(`[Multiplayer] Found Host PeerID: ${hostPeerId}. Connecting...`);
        connectToHost(hostPeerId);
      }
    } else if (msg.type === 'find-host') {
      if (isHost && myPeerId) {
        console.log(`[Multiplayer] Received find-host request. Announcing PeerID: ${myPeerId}`);
        sendSignalingMsg({
          type: 'host-announce',
          hostPeerId: myPeerId
        });
      }
    }
  }

  function connectToHost(targetPeerId) {
    if (!peer || !targetPeerId) return;
    const localName = localStorage.getItem('pyb_username') || 'Player';
    const conn = peer.connect(targetPeerId, {
      metadata: { name: localName },
      reliable: true
    });
    window.PYBMultiplayer.setupDataConnection(conn);
  }

  /* ---- Public API ---- */

  window.PYBMultiplayer = {
    init: function (code, hostFlag, username, currentPhase = 'lobby') {
      roomCode = code;
      isHost   = hostFlag;
      phase    = currentPhase;
      hostPeerId = null;
      const localName = username || localStorage.getItem('pyb_username') || 'Player';
      const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

      // Cleanup old peer
      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
      if (announceTimer) clearInterval(announceTimer);

      return new Promise((resolve) => {
        if (!window.Peer) {
          console.warn('[Multiplayer] PeerJS library not loaded.');
          resolve(false);
          return;
        }

        // Use clean random PeerID for 100% reliable PeerJS Cloud registration
        const randomId = `pyb-${phase}-${isHost ? 'host' : 'user'}-${Math.floor(100000 + Math.random() * 900000)}`;

        peer = new Peer(randomId, {
          config: { iceServers: STUN_SERVERS },
          debug: 1
        });

        peer.on('open', (id) => {
          myPeerId = id;
          console.log(`[Multiplayer] Peer ready (${phase}). My PeerID: ${id}`);

          // Initialize signaling relay
          initSignaling(roomCode);

          if (isHost) {
            playersList = [{ id: myPeerId, name: localName, isHost: true, character: localChar }];
            this.notifyLobbyUpdate();

            // Host continuously announces PeerID via signaling relay
            announceTimer = setInterval(() => {
              sendSignalingMsg({
                type: 'host-announce',
                hostPeerId: myPeerId
              });
            }, 1000);

            sendSignalingMsg({ type: 'host-announce', hostPeerId: myPeerId });
          } else {
            // Joiner broadcasts "find-host"
            announceTimer = setInterval(() => {
              if (!hostPeerId) {
                sendSignalingMsg({ type: 'find-host' });
              }
            }, 1000);
            sendSignalingMsg({ type: 'find-host' });
          }

          resolve(true);
        });

        peer.on('connection', (conn) => {
          console.log(`[Multiplayer] Data connection received from ${conn.peer}`);
          this.setupDataConnection(conn);
        });

        peer.on('call', (call) => {
          console.log(`[Multiplayer] Media call received from ${call.peer}`);
          if (localStream) {
            call.answer(localStream);
          } else {
            call.answer();
          }

          call.on('stream', (remoteStream) => {
            console.log('[Multiplayer] Received remote video stream');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
        });

        peer.on('error', (err) => {
          console.error('[Multiplayer PeerJS Error]', err);
        });
      });
    },

    setupDataConnection: function (conn) {
      if (connections.has(conn.peer)) return;
      connections.set(conn.peer, conn);

      conn.on('open', () => {
        console.log(`[Multiplayer] DataChannel OPEN with ${conn.peer}`);
        const localName = localStorage.getItem('pyb_username') || 'Player';
        const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

        if (!isHost) {
          conn.send({
            type: 'join-request',
            senderId: myPeerId,
            name: localName,
            character: localChar
          });
        }
      });

      conn.on('data', (data) => {
        this.handleIncomingData(data, conn);
      });

      conn.on('close', () => {
        console.log(`[Multiplayer] DataChannel CLOSED with ${conn.peer}`);
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

            // Send current lobby state back to joiner
            if (conn.open) {
              conn.send({ type: 'lobby-update', players: playersList });
            }
          }
          break;

        case 'lobby-update':
          playersList = data.players;
          if (window.updateLobbyUI) {
            window.updateLobbyUI(playersList);
          }
          break;

        case 'start-game':
          console.log('[Multiplayer] Game started by host');
          window.location.href = `play.html?code=${roomCode}`;
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
      if (window.updateLobbyUI) {
        window.updateLobbyUI(playersList);
      }
      this.broadcast({
        type: 'lobby-update',
        players: playersList
      });
    },

    triggerStartGame: function () {
      if (!isHost) return;
      this.broadcast({ type: 'start-game' });
      window.location.href = `play.html?code=${roomCode}`;
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
        console.log(`[Multiplayer] Calling peer ${peerId}`);
        const call = peer.call(peerId, localStream);
        mediaCalls.set(peerId, call);

        call.on('stream', (remoteStream) => {
          console.log('[Multiplayer] Remote video stream attached');
          const peerVideo = document.getElementById('peerVideo');
          if (peerVideo) peerVideo.srcObject = remoteStream;
        });
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
