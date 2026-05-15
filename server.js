const { createServer } = require('http');
const next = require('next');
const { WebSocketServer } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST;
const port = Number(process.env.PORT || 8080);

const app = next({ dev });
const handle = app.getRequestHandler();

const rooms = new Map();
const RECONNECT_GRACE_MS = 30000;

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      host: null,
      guest: null,
    });
  }
  return rooms.get(roomId);
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function connectedSeats(room) {
  return ['host', 'guest']
    .map((role) => room[role])
    .filter((seat) => seat?.ws && seat.ws.readyState === seat.ws.OPEN);
}

function broadcast(room, sender, message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);

  for (const seat of connectedSeats(room)) {
    if (seat.ws !== sender) {
      seat.ws.send(data);
    }
  }
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function makePlayerId() {
  return Math.random().toString(36).slice(2, 12);
}

function getReusableRole(room, playerId) {
  if (room.host?.playerId === playerId) return 'host';
  if (room.guest?.playerId === playerId) return 'guest';
  return null;
}

function getOpenRole(room) {
  if (!room.host) return 'host';
  if (!room.guest) return 'guest';
  return null;
}

function hasConnectedOpponent(room, role) {
  const opponent = role === 'host' ? room.guest : room.host;
  return Boolean(opponent?.ws && opponent.ws.readyState === opponent.ws.OPEN);
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (!room.host && !room.guest) {
    rooms.delete(roomId);
  }
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error(`HTTP error while handling ${req.url}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal server error');
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: true,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || makeRoomId();
    const playerId = url.searchParams.get('player') || makePlayerId();
    const room = getRoom(roomId);
    const reusableRole = getReusableRole(room, playerId);
    const role = reusableRole || getOpenRole(room);

    if (!role) {
      send(ws, { type: 'roomFull', roomId });
      ws.close(1008, 'Room is full');
      return;
    }

    const previousSeat = room[role];
    if (previousSeat?.disconnectTimer) {
      clearTimeout(previousSeat.disconnectTimer);
    }

    if (previousSeat?.ws && previousSeat.ws.readyState === previousSeat.ws.OPEN) {
      previousSeat.ws.close(1000, 'Replaced by a newer connection');
    }

    room[role] = {
      playerId,
      ws,
      disconnectTimer: null,
    };

    const ip = req.socket.remoteAddress;
    const opponentPresent = hasConnectedOpponent(room, role);
    console.log(`[+] ${role} ${reusableRole ? 'reconnected to' : 'joined'} room ${roomId} from ${ip}`);

    send(ws, { type: 'role', role, roomId, playerId, opponentPresent });

    if (opponentPresent) {
      broadcast(room, ws, role === 'guest' ? { type: 'guestJoined' } : { type: 'opponentReconnected' });
    }

    ws.on('message', (data) => {
      broadcast(room, ws, data);
    });

    ws.on('close', () => {
      console.log(`[-] ${role} left room ${roomId}`);

      const currentSeat = room[role];
      if (!currentSeat || currentSeat.ws !== ws) return;

      currentSeat.ws = null;
      broadcast(room, ws, { type: 'opponentDisconnected', graceMs: RECONNECT_GRACE_MS });

      currentSeat.disconnectTimer = setTimeout(() => {
        const latestRoom = rooms.get(roomId);
        if (!latestRoom || latestRoom[role]?.ws) return;

        latestRoom[role] = null;
        broadcast(latestRoom, null, { type: 'opponentLeft' });
        cleanupRoom(roomId);
      }, RECONNECT_GRACE_MS);

      cleanupRoom(roomId);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error in room ${roomId} (${role}): ${err.message}`);
    });
  });

  const onListen = () => {
    const boundHost = hostname || 'all local addresses';
    console.log('===============================================');
    console.log('  Ping Pong Next + WebSocket Server');
    console.log('===============================================');
    console.log(`  Local:   http://localhost:${port}`);
    console.log(`  Bound:   ${boundHost}`);
    console.log('  Invite:  open the page, then share its room URL');
    console.log('===============================================');
  };

  if (hostname) {
    httpServer.listen(port, hostname, onListen);
  } else {
    httpServer.listen(port, onListen);
  }
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
