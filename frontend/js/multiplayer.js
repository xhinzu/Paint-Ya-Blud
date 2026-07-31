/* Paint Ya Blud - Direct 1-on-1 WebRTC Peer-to-Peer (P2P) Engine
 *
 * Direct P2P Architecture with TURN Fallback:
 * - Direct 1-on-1 P2P connection between Host and Joiner
 * - STUN + TURN Relay Servers (Metered.ca OpenRelay + Google STUN + Twilio STUN)
 *   Ensures video & voice stream NAT/firewall traversal across different households & routers
 * - Automatic Media Stream On-Demand Answering
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
  let retryTimer   = null;
  let isConnected  = false;

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

  window.PYBMultiplayer = {
    init: function (code, hostFlag, username, currentPhase = 'lobby') {
      roomCode    = code;
      isHost      = hostFlag;
      phase       = currentPhase;
      isConnected = false;

      const localName = username || localStorage.getItem('pyb_username') || 'Player';
      const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

      // Clean up previous timers & sockets
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
      connections.clear();
      mediaCalls.clear();

      const prefix       = phase === 'game' ? 'pyb-game' : (phase === 'reveal' ? 'pyb-reveal' : 'pyb-room');
      const targetHostId = `${prefix}-${roomCode}`;
      const myTargetId   = isHost
        ? targetHostId
        : `${prefix}-user-${Math.floor(1000 + Math.random() * 9000)}`;

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
          } else {
            // Direct P2P connect to host with active retry until open
            const tryP2PConnect = () => {
              if (isConnected) return;
              console.log(`[P2P] Connecting directly to Host: ${targetHostId}`);
              const conn = peer.connect(targetHostId, {
                metadata: { name: localName, character: localChar },
                reliable: true
              });
              this.setupDataConnection(conn);
            };

            tryP2PConnect();
            retryTimer = setInterval(tryP2PConnect, 250);
          }

          resolve(true);
        });

        peer.on('connection', (conn) => {
          console.log(`[P2P] Incoming direct connection from ${conn.peer}`);
          this.setupDataConnection(conn);
        });

        peer.on('call', async (call) => {
          console.log(`[P2P] Incoming media call from ${call.peer}`);
          mediaCalls.set(call.peer, call);

          if (!localStream) {
            try {
              localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              const localVideo = document.getElementById('localVideo');
              if (localVideo) localVideo.srcObject = localStream;
            } catch (err) {
              console.warn('[P2P] MediaStream access failed:', err);
            }
          }

          if (localStream) {
            call.answer(localStream);
          } else {
            call.answer();
          }

          call.on('stream', (remoteStream) => {
            console.log('[P2P] Direct remote video & voice stream connected (incoming call)');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
        });

        peer.on('error', (err) => {
          console.warn('[P2P Error]', err.type, err.message);
          if (err.type === 'unavailable-id' && isHost) {
            setTimeout(() => this.init(code, hostFlag, username, currentPhase), 1000);
          }
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
          isConnected = true;
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }

          conn.send({
            type: 'join-request',
            senderId: myPeerId,
            name: localName,
            character: localChar
          });
        }

        // Trigger direct 1-on-1 P2P media call if webcam stream is active
        if (localStream && peer && !mediaCalls.has(conn.peer)) {
          console.log(`[P2P] Calling ${conn.peer} for direct 1-on-1 video/voice stream`);
          const call = peer.call(conn.peer, localStream);
          mediaCalls.set(conn.peer, call);

          call.on('stream', (remoteStream) => {
            console.log('[P2P] Direct video & voice stream connected');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
        }
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
          if (window.updateLobbyUI) {
            window.updateLobbyUI(playersList);
          }
          break;

        case 'start-game':
          console.log('[P2P] Game started by host');
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
        if (conn.open && !mediaCalls.has(peerId)) {
          console.log(`[P2P] Direct video call to ${peerId}`);
          const call = peer.call(peerId, localStream);
          mediaCalls.set(peerId, call);

          call.on('stream', (remoteStream) => {
            console.log('[P2P] Attached remote video stream');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
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
