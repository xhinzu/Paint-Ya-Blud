/* Paint Ya Blud - Global PeerJS & WebRTC Realtime Multiplayer Engine */

(function () {
  let peer = null;
  let connections = new Map(); // peerId -> DataConnection
  let mediaCalls = new Map();  // peerId -> MediaConnection
  let myPeerId = null;
  let roomCode = null;
  let isHost = false;

  let localStream = null;
  let playersList = []; // [{ id, name, ready, isHost }]

  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  window.PYBMultiplayer = {
    // 1. Initialize Peer Connection
    init: function (code, hostFlag, username) {
      roomCode = code;
      isHost = hostFlag;
      const localName = username || localStorage.getItem('pyb_username') || 'Player';

      const targetId = isHost ? `pyb-room-${roomCode}` : `pyb-user-${Math.floor(1000 + Math.random() * 9000)}`;

      return new Promise((resolve, reject) => {
        if (!window.Peer) {
          console.warn('PeerJS library not loaded. Falling back to local simulation mode.');
          resolve(false);
          return;
        }

        peer = new Peer(targetId, {
          config: { iceServers: STUN_SERVERS },
          debug: 1
        });

        peer.on('open', (id) => {
          myPeerId = id;
          console.log(`[Multiplayer] Connected to Peer Cloud. PeerID: ${id}`);

          if (isHost) {
            playersList = [{ id: myPeerId, name: localName, isHost: true }];
            this.notifyLobbyUpdate();
          } else {
            // Join host room
            const hostPeerId = `pyb-room-${roomCode}`;
            const conn = peer.connect(hostPeerId, {
              metadata: { name: localName }
            });
            this.setupDataConnection(conn);
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
            console.log('[Multiplayer] Remote media stream attached');
            const peerVideo = document.getElementById('peerVideo');
            if (peerVideo) peerVideo.srcObject = remoteStream;
          });
        });

        peer.on('error', (err) => {
          console.error('[Multiplayer Error]', err);
          if (err.type === 'unavailable-id' && isHost) {
            console.warn('Room code already hosted or taken.');
          }
          resolve(false);
        });
      });
    },

    // Setup DataConnection Handlers
    setupDataConnection: function (conn) {
      connections.set(conn.peer, conn);

      conn.on('open', () => {
        console.log(`[Multiplayer] DataChannel open with ${conn.peer}`);
        const localName = localStorage.getItem('pyb_username') || 'Player';

        // Only the joiner sends a join-request to the host.
        // (When host receives a connection, conn.peer IS the joiner's ID — host doesn't need to announce itself.)
        if (!isHost) {
          conn.send({
            type: 'join-request',
            senderId: myPeerId,   // FIX: use OWN peer ID, not conn.peer (which is the remote/host ID)
            name: localName
          });
        }
      });

      conn.on('data', (data) => {
        this.handleIncomingData(data, conn);
      });

      conn.on('close', () => {
        console.log(`[Multiplayer] DataChannel closed with ${conn.peer}`);
        connections.delete(conn.peer);
        if (isHost) {
          playersList = playersList.filter(p => p.id !== conn.peer);
          this.notifyLobbyUpdate();
        }
      });
    },

    // Handle Incoming Data Messages
    handleIncomingData: function (data, conn) {
      if (!data || !data.type) return;

      switch (data.type) {
        case 'join-request':
          if (isHost) {
            // Use conn.peer as authoritative ID (actual PeerJS connection ID from the remote side)
            const joinerId = conn.peer;
            const existing = playersList.find(p => p.id === joinerId);
            if (!existing) {
              playersList.push({ id: joinerId, name: data.name || 'Player', isHost: false });
            }
            this.notifyLobbyUpdate();

            // Also send full lobby state directly back to the new joiner immediately
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

    // Broadcast Lobby State to all connected peers
    notifyLobbyUpdate: function () {
      if (window.updateLobbyUI) {
        window.updateLobbyUI(playersList);
      }

      this.broadcast({
        type: 'lobby-update',
        players: playersList
      });
    },

    // Broadcast game start signal
    triggerStartGame: function () {
      if (!isHost) return;
      this.broadcast({ type: 'start-game' });
      window.location.href = `play.html?code=${roomCode}`;
    },

    // Broadcast stroke point to peers
    sendStrokePoint: function (strokeData) {
      this.broadcast({
        type: 'draw-stroke',
        stroke: strokeData
      });
    },

    // Broadcast clear canvas event
    sendClearCanvas: function () {
      this.broadcast({ type: 'clear-canvas' });
    },

    // Broadcast final canvas result image URL
    sendCanvasResult: function (dataUrl) {
      this.broadcast({
        type: 'peer-canvas-result',
        drawnData: dataUrl
      });
    },

    // Establish WebRTC Video Stream with Peers
    startVideoCall: function (stream) {
      localStream = stream;
      if (!peer) return;

      connections.forEach((conn, peerId) => {
        console.log(`[Multiplayer] Initiating video call to ${peerId}`);
        const call = peer.call(peerId, localStream);
        mediaCalls.set(peerId, call);

        call.on('stream', (remoteStream) => {
          console.log('[Multiplayer] Received remote video stream from call');
          const peerVideo = document.getElementById('peerVideo');
          if (peerVideo) peerVideo.srcObject = remoteStream;
        });
      });
    },

    // Helper: Broadcast data payload to all connected peers
    broadcast: function (data) {
      connections.forEach((conn) => {
        if (conn.open) {
          conn.send(data);
        }
      });
    },

    getPlayers: function () {
      return playersList;
    },

    getIsHost: function () {
      return isHost;
    }
  };
})();
