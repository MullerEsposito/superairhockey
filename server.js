const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const rooms = new Map();

function randomRoomId(length = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostSocketId: null,
      players: new Map(),
      score: { left: 0, right: 0 },
    });
  }
  return rooms.get(roomId);
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('host:create_room', () => {
    let roomId = randomRoomId();
    while (rooms.has(roomId)) roomId = randomRoomId();

    const room = ensureRoom(roomId);
    room.hostSocketId = socket.id;

    socket.join(roomId);
    socket.emit('room:created', { roomId });
  });

  socket.on('host:join_room', ({ roomId }) => {
    if (!roomId) return;
    const room = ensureRoom(roomId);
    room.hostSocketId = socket.id;
    socket.join(roomId);
    socket.emit('room:created', { roomId });
  });

  socket.on('controller:join_room', ({ roomId, playerName }) => {
    if (!roomId) {
      socket.emit('controller:error', { message: 'roomId ausente' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId) {
      socket.emit('controller:error', { message: 'Sala não encontrada ou sem host' });
      return;
    }

    const playerId = socket.id;
    room.players.set(playerId, {
      playerName: playerName || `Player-${room.players.size + 1}`,
      x: 0,
      y: 0,
      side: room.players.size % 2 === 0 ? 'left' : 'right',
      joinedAt: Date.now(),
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'controller';

    socket.emit('controller:joined', {
      playerId,
      side: room.players.get(playerId).side,
      roomId,
    });

    io.to(room.hostSocketId).emit('host:player_joined', {
      playerId,
      playerName: room.players.get(playerId).playerName,
      side: room.players.get(playerId).side,
    });
  });

  socket.on('controller:move', ({ roomId, ax = 0, ay = 0, ts }) => {
    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId || !room.players.has(socket.id)) return;

    const player = room.players.get(socket.id);
    player.x = ax;
    player.y = ay;

    io.to(room.hostSocketId).emit('host:player_move', {
      playerId: socket.id,
      ax,
      ay,
      ts: ts || Date.now(),
    });
  });

  socket.on('host:goal', ({ roomId, side }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    if (side === 'left' || side === 'right') {
      room.score[side] += 1;
      io.to(roomId).emit('game:score', { score: room.score, side });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.hostSocketId === socket.id) {
        io.to(roomId).emit('game:ended', { reason: 'host_disconnected' });
        rooms.delete(roomId);
        continue;
      }

      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        if (room.hostSocketId) {
          io.to(room.hostSocketId).emit('host:player_left', { playerId: socket.id });
        }
      }
    }
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SuperAirHockey MVP server listening on http://localhost:${port}`);
});
