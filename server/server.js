const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map(); // roomCode -> { players: Set(socketId), settings: {} }

io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  // Create Room
  socket.on('create-room', ({ durationMins, maxPlayers }, callback) => {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms.set(roomCode, {
      code: roomCode,
      creator: socket.id,
      maxPlayers: maxPlayers || 2,
      durationMins: durationMins || 1,
      players: new Map([[socket.id, { id: socket.id, ready: true }]])
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;

    console.log(`[Room Created] Code: ${roomCode} by ${socket.id}`);
    if (typeof callback === 'function') callback({ success: true, roomCode });
  });

  // Join Room
  socket.on('join-room', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
      return;
    }

    if (room.players.size >= room.maxPlayers) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room full' });
      return;
    }

    room.players.set(socket.id, { id: socket.id, ready: true });
    socket.join(roomCode);
    socket.roomCode = roomCode;

    console.log(`[Room Joined] Socket ${socket.id} joined room ${roomCode}`);
    if (typeof callback === 'function') callback({ success: true, roomCode });

    // Notify other peers in room
    socket.to(roomCode).emit('peer-joined', { peerId: socket.id });
  });

  // Relay WebRTC Signaling Messages (offer, answer, ice-candidate)
  socket.on('signal', ({ targetId, signalData }) => {
    io.to(targetId).emit('signal', {
      senderId: socket.id,
      signalData
    });
  });

  // Relay Live Stroke Events
  socket.on('draw-stroke', ({ strokeData }) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('draw-stroke', strokeData);
    }
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    if (socket.roomCode && rooms.has(socket.roomCode)) {
      const room = rooms.get(socket.roomCode);
      room.players.delete(socket.id);
      socket.to(socket.roomCode).emit('peer-left', { peerId: socket.id });
      if (room.players.size === 0) {
        rooms.delete(socket.roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 Paint Ya Blud Signaling Server running on port ${PORT}`);
});
