/* Paint Ya Blud - Self-Healing Cross-Household WebRTC Multiplayer Engine
 *
 * Features:
 * - STUN + TURN Relay Servers (Metered.ca OpenRelay + Google STUN + Twilio STUN)
 *   Enables WebRTC connections across different households, home routers, cellular NATs, and firewalls
 * - Deterministic Host PeerIDs (`pyb-host-[code]`, `pyb-gamehost-[code]`, `pyb-revealhost-[code]`)
 * - Joiner Active Retry Loop (retries connection every 1.5s until Host acknowledges)
 * - Error Recovery & Draft Connection Cleanup
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
  let isConnectedToHost = false;

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
      roomCode = code;
      isHost   = hostFlag;
      phase    = currentPhase;
      isConnectedToHost = false;

      const localName = username || localStorage.getItem('pyb_username') || 'Player';
      const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

      // Clean up previous peer instance & timers
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      if (peer) {
        try { peer.destroy(); } catch (_) {}
        peer = null;
      }
      connections.clear();
      mediaCalls.clear();

      const hostIdPrefix = phase === 'game' ? 'pyb-gamehost' : (phase === 'reveal' ? 'pyb-revealhost' : 'pyb-host');
      const userIdPrefix = phase === 'game' ? 'pyb-gameuser' : (phase === 'reveal' ? 'pyb-revealuser' : 'pyb-user');

      const targetHostId = `${hostIdPrefix}-${roomCode}`;
      const myTargetId   = isHost
        ? targetHostId
        : `${userIdPrefix}-${roomCode}-${Math.floor(1000 + Math.random() * 9000)}`;

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
          console.log(`[Multiplayer] Connected to Peer Cloud (${phase}). PeerID: ${id}`);

          if (isHost) {
            playersList = [{ id: myPeerId, name: localName, isHost: true, character: localChar }];
            this.notifyLobbyUpdate();
          } else {
            // Joiner active retry loop until connected to Host
            const attemptConnect = () => {
              if (isConnectedToHost) return;
              console.log(`[Multiplayer] Attempting connection to Host (${targetHostId})...`);
              const conn = peer.connect(targetHostId, {
                metadata: { name: localName, character: localChar },
                reliable: true
              });
              this.setupDataConnection(conn);
            };

            attemptConnect();
            retryTimer = setInterval(attemptConnect, 1500);
          }

          resolve(true);
        });

        peer.on('connection', (conn) => {
          console.log(`[Multiplayer] Incoming connection from ${conn.peer}`);
          this.setupDataConnection(conn);
        });

        peer.on('call', (call) => {
          console.log(`[Multiplayer] Incoming media call from ${call.peer}`);
          if (localStream) {
            call.answer(localStream);
          } else {
            call.answer();
          }

          call.on('stream', (remoteStream) => {
            console.log('[Multiplayer] Attached remote video stream');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
        });

        peer.on('error', (err) => {
          console.warn('[Multiplayer PeerJS Error]', err.type, err.message);
          // If host ID collision occurs (e.g. fast page refresh), retry clean after 1s
          if (err.type === 'unavailable-id' && isHost) {
            console.warn('[Multiplayer] Host ID busy, retrying in 1s...');
            setTimeout(() => this.init(code, hostFlag, username, currentPhase), 1000);
          }
        });
      });
    },

    setupDataConnection: function (conn) {
      if (!conn) return;

      conn.on('open', () => {
        console.log(`[Multiplayer] DataChannel OPEN with ${conn.peer}`);
        connections.set(conn.peer, conn);

        const localName = localStorage.getItem('pyb_username') || 'Player';
        const localChar = JSON.parse(localStorage.getItem('pyb_character') || '{}');

        if (!isHost) {
          isConnectedToHost = true;
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }

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

      conn.on('error', (err) => {
        console.warn('[Multiplayer] DataChannel connection error:', err);
        connections.delete(conn.peer);
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

            // Send full lobby state back to joiner
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
        console.log(`[Multiplayer] Initiating video call to ${peerId}`);
        const call = peer.call(peerId, localStream);
        mediaCalls.set(peerId, call);

        call.on('stream', (remoteStream) => {
          console.log('[Multiplayer] Received remote video stream');
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
