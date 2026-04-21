const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const defaultPort = Number(process.env.PORT || 3001);
const certPath = process.env.HTTPS_PFX_PATH || path.join(__dirname, 'certs', 'dev-cert.pfx');
const certPassphrase = process.env.HTTPS_PFX_PASSPHRASE || 'superairhockey-dev';
const disableHttps = ['1', 'true', 'yes'].includes(String(process.env.DISABLE_HTTPS || '').toLowerCase());
const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
const distPath = path.join(__dirname, 'dist');
const hasClientBuild = fs.existsSync(path.join(distPath, 'index.html'));

function createWebServer() {
  if (!disableHttps && fs.existsSync(certPath)) {
    return {
      protocol: 'https',
      server: https.createServer(
        {
          pfx: fs.readFileSync(certPath),
          passphrase: certPassphrase,
        },
        app,
      ),
    };
  }

  return {
    protocol: 'http',
    server: http.createServer(app),
  };
}

const { protocol, server } = createWebServer();
const io = new Server(server, {
  cors: { origin: '*' },
});

const rooms = new Map();
const TABLE_PADDING = 30;
const PADDLE_RADIUS = 36;
const PUCK_RADIUS = 14;
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;
const GAME_TICK_MS = 1000 / 60;

function createInitialPuck() {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 3,
    vy: 5,
    r: PUCK_RADIUS,
  };
}

function randomRoomId(length = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostSocketId: null,
      players: new Map(),
      score: { top: 0, bottom: 0 },
      puck: createInitialPuck(),
      gameState: null,
      matchStarted: false,
      paused: false,
    });
  }
  return rooms.get(roomId);
}

function serializeGameState(roomId, room) {
  return {
    roomId,
    matchStarted: room.matchStarted,
    paused: room.paused,
    readyPlayers: room.players.size,
    paddles: Array.from(room.players.entries()).map(([playerId, player]) => ({
      playerId,
      playerName: player.playerName,
      side: player.side,
      x: player.x,
      y: player.y,
      radius: PADDLE_RADIUS,
    })),
    puck: { ...room.puck },
    score: room.score,
  };
}

function broadcastGameState(roomId, room) {
  room.gameState = serializeGameState(roomId, room);
  io.to(roomId).emit('game:state', {
    roomId,
    state: room.gameState,
    score: room.score,
  });
}

function resetPuck(room) {
  room.puck = {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: (Math.random() > 0.5 ? 1 : -1) * 3,
    vy: (Math.random() > 0.5 ? 1 : -1) * 5,
    r: PUCK_RADIUS,
  };
}

function clampPlayerPosition(player, nextX, nextY) {
  const minY = player.side === 'top' ? 40 : CANVAS_HEIGHT / 2 + 10;
  const maxY = player.side === 'top' ? CANVAS_HEIGHT / 2 - 10 : CANVAS_HEIGHT - 40;

  player.x = Math.max(40, Math.min(CANVAS_WIDTH - 40, nextX));
  player.y = Math.max(minY, Math.min(maxY, nextY));
}

function updateMatchStartState(room) {
  const shouldStart = room.players.size >= 2;
  if (shouldStart && !room.matchStarted) {
    room.matchStarted = true;
    room.paused = false;
    resetPuck(room);
    return;
  }

  if (!shouldStart) {
    room.matchStarted = false;
    room.paused = false;
    room.puck = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: 0,
      vy: 0,
      r: PUCK_RADIUS,
    };
  }
}

function updateRoom(roomId, room) {
  if (!room.hostSocketId) return;
  updateMatchStartState(room);
  if (!room.matchStarted || room.paused) {
    broadcastGameState(roomId, room);
    return;
  }

  const puck = room.puck;
  puck.x += puck.vx;
  puck.y += puck.vy;

  if (puck.x < TABLE_PADDING + puck.r || puck.x > CANVAS_WIDTH - TABLE_PADDING - puck.r) {
    puck.vx *= -1;
    puck.x = Math.max(TABLE_PADDING + puck.r, Math.min(CANVAS_WIDTH - TABLE_PADDING - puck.r, puck.x));
  }

  for (const [, paddle] of room.players) {
    const dx = puck.x - paddle.x;
    const dy = puck.y - paddle.y;
    const distance = Math.hypot(dx, dy);
    if (distance < puck.r + PADDLE_RADIUS) {
      const nx = dx / (distance || 1);
      const ny = dy / (distance || 1);
      const speed = Math.hypot(puck.vx, puck.vy) + 0.35;
      puck.vx = nx * speed;
      puck.vy = ny * speed;
    }
  }

  if (puck.y < puck.r) {
    room.score.bottom += 1;
    io.to(roomId).emit('game:score', { score: room.score, side: 'bottom' });
    resetPuck(room);
  }

  if (puck.y > CANVAS_HEIGHT - puck.r) {
    room.score.top += 1;
    io.to(roomId).emit('game:score', { score: room.score, side: 'top' });
    resetPuck(room);
  }

  broadcastGameState(roomId, room);
}

function isSideAvailable(room, side) {
  for (const [, player] of room.players) {
    if (player.side === side) return false;
  }
  return true;
}

function serializeRooms() {
  const availableRooms = [];

  for (const [roomId, room] of rooms.entries()) {
    if (!room.hostSocketId) continue;

    const sides = [];
    for (const [, player] of room.players) {
      sides.push(player.side);
    }

    availableRooms.push({
      roomId,
      players: room.players.size,
      availableSides: ['top', 'bottom'].filter((side) => !sides.includes(side)),
    });
  }

  return availableRooms.sort((a, b) => a.roomId.localeCompare(b.roomId));
}

app.get('/api/runtime-config', (_req, res) => {
  res.json({
    publicAppUrl,
    protocol,
    port: defaultPort,
    httpsEnabled: protocol === 'https',
  });
});

if (hasClientBuild) {
  app.use(express.static(distPath));
}

if (hasClientBuild) {
  app.get(['/', '/host', '/controller', '/spectator', '/host.html', '/controller.html', '/spectator.html'], (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get(['/', '/host', '/controller', '/spectator', '/host.html', '/controller.html', '/spectator.html'], (_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('Frontend React ainda nao foi buildado. Rode "npm run client:dev" ou "npm run build".');
  });
}

io.on('connection', (socket) => {
  socket.on('rooms:list', () => {
    socket.emit('rooms:list', { rooms: serializeRooms() });
  });

  socket.on('host:create_room', () => {
    let roomId = randomRoomId();
    while (rooms.has(roomId)) roomId = randomRoomId();

    const room = ensureRoom(roomId);
    room.hostSocketId = socket.id;

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'host';
    socket.emit('room:created', { roomId });
    updateMatchStartState(room);
    broadcastGameState(roomId, room);
    io.emit('rooms:list', { rooms: serializeRooms() });
  });

  socket.on('host:join_room', ({ roomId }) => {
    if (!roomId) return;

    const room = ensureRoom(roomId);
    room.hostSocketId = socket.id;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'host';
    socket.emit('room:created', { roomId });
    updateMatchStartState(room);
    broadcastGameState(roomId, room);
    io.emit('rooms:list', { rooms: serializeRooms() });
  });

  socket.on('spectator:join_room', ({ roomId }) => {
    if (!roomId) {
      socket.emit('spectator:error', { message: 'roomId ausente' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId) {
      socket.emit('spectator:error', { message: 'Sala nao encontrada ou sem host' });
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'spectator';

    socket.emit('spectator:joined', {
      roomId,
      score: room.score,
      gameState: room.gameState || serializeGameState(roomId, room),
    });
  });

  socket.on('controller:join_room', ({ roomId, playerName, desiredSide }) => {
    if (!roomId) {
      socket.emit('controller:error', { message: 'roomId ausente' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId) {
      socket.emit('controller:error', { message: 'Sala nao encontrada ou sem host' });
      return;
    }

    const selectedSide = desiredSide === 'top' || desiredSide === 'bottom' ? desiredSide : null;
    if (selectedSide && !isSideAvailable(room, selectedSide)) {
      socket.emit('controller:error', { message: `Lado ${selectedSide} ja esta ocupado.` });
      return;
    }

    const fallbackSide = isSideAvailable(room, 'bottom') ? 'bottom' : 'top';
    if (!selectedSide && !isSideAvailable(room, fallbackSide)) {
      socket.emit('controller:error', { message: 'Sala cheia.' });
      return;
    }

    const playerId = socket.id;
    const assignedSide = selectedSide || fallbackSide;

    room.players.set(playerId, {
      playerName: playerName || `Player-${room.players.size + 1}`,
      x: CANVAS_WIDTH * 0.5,
      y: assignedSide === 'top' ? CANVAS_HEIGHT * 0.18 : CANVAS_HEIGHT * 0.82,
      side: assignedSide,
      joinedAt: Date.now(),
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'controller';

    socket.emit('controller:joined', {
      playerId,
      side: assignedSide,
      roomId,
    });

    io.to(room.hostSocketId).emit('host:player_joined', {
      playerId,
      playerName: room.players.get(playerId).playerName,
      side: assignedSide,
    });
    updateMatchStartState(room);
    broadcastGameState(roomId, room);
    io.emit('rooms:list', { rooms: serializeRooms() });
  });

  socket.on('controller:move', ({ roomId, ax = 0, ay = 0, x, y, ts }) => {
    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId || !room.players.has(socket.id)) return;
    if (room.paused) return;

    const player = room.players.get(socket.id);
    const hasAbsoluteTarget = Number.isFinite(x) && Number.isFinite(y);

    if (hasAbsoluteTarget) {
      clampPlayerPosition(player, x, y);
    } else {
      const gain = 52;
      clampPlayerPosition(
        player,
        player.x + Math.max(-1, Math.min(1, ax / 5)) * gain,
        player.y + Math.max(-1, Math.min(1, ay / 5)) * gain,
      );
    }

    io.to(room.hostSocketId).emit('host:player_move', {
      playerId: socket.id,
      ax,
      ay,
      ts: ts || Date.now(),
    });
    broadcastGameState(roomId, room);
  });

  socket.on('controller:toggle_pause', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.hostSocketId || !room.players.has(socket.id) || !room.matchStarted) return;

    room.paused = !room.paused;
    broadcastGameState(roomId, room);
  });

  socket.on('host:goal', ({ roomId, side }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostSocketId !== socket.id) return;

    if (side === 'top' || side === 'bottom') {
      room.score[side] += 1;
      io.to(roomId).emit('game:score', { score: room.score, side });
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.hostSocketId === socket.id) {
        io.to(roomId).emit('game:ended', { reason: 'host_disconnected' });
        rooms.delete(roomId);
        io.emit('rooms:list', { rooms: serializeRooms() });
        continue;
      }

      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        if (room.hostSocketId) {
          io.to(room.hostSocketId).emit('host:player_left', { playerId: socket.id });
        }
        updateMatchStartState(room);
        broadcastGameState(roomId, room);
        io.emit('rooms:list', { rooms: serializeRooms() });
      }
    }
  });
});

setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    updateRoom(roomId, room);
  }
}, GAME_TICK_MS);

const port = defaultPort;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SuperAirHockey MVP server listening on ${protocol}://localhost:${port}`);
  if (publicAppUrl) {
    // eslint-disable-next-line no-console
    console.log(`Public app URL configured: ${publicAppUrl}`);
  }
  if (protocol === 'http') {
    // eslint-disable-next-line no-console
    console.log(
      disableHttps
        ? 'HTTPS disabled via DISABLE_HTTPS.'
        : `HTTPS certificate not found at ${certPath}. Run "npm run certs" to enable HTTPS.`,
    );
  }
});
