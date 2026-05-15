const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT     = 8080;
const HTML_FILE = path.join(__dirname, 'offline_ping_pong_game_html.html');

// ── HTTP server: serves the game HTML to any browser ─────────────────────────
const httpServer = http.createServer((req, res) => {
  fs.readFile(HTML_FILE, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Game file not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// ── WebSocket server: multiplayer relay ───────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const rooms = {};
let totalConnections = 0;

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  totalConnections++;
  console.log(`[+] Player connected from ${ip}  (total: ${wss.clients.size})`);

  // Find a room with 1 waiting player, or create a new one
  let roomId = Object.keys(rooms).find(id => rooms[id].length === 1);
  if (!roomId) { roomId = Date.now().toString(); rooms[roomId] = []; }

  rooms[roomId].push(ws);
  const role = rooms[roomId].length === 1 ? 'host' : 'guest';
  ws.send(JSON.stringify({ type: 'role', role }));
  console.log(`    Assigned role: ${role}  | room: ${roomId}`);

  if (role === 'guest') {
    console.log(`    Room ${roomId} is now FULL — game can start!`);
    // Notify the host that their opponent has joined
    rooms[roomId].forEach(client => {
      if (client !== ws && client.readyState === 1)
        client.send(JSON.stringify({ type: 'guestJoined' }));
    });
  }

  ws.on('message', (data) => {
    rooms[roomId].forEach(client => {
      if (client !== ws && client.readyState === 1) client.send(data);
    });
  });

  ws.on('close', () => {
    console.log(`[-] Player (${role}) disconnected from room ${roomId}`);
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    rooms[roomId].forEach(client => {
      if (client.readyState === 1)
        client.send(JSON.stringify({ type: 'opponentLeft' }));
    });
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log(`    Room ${roomId} deleted.`);
    }
  });

  ws.on('error', err => console.error(`    WS error: ${err.message}`));
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  🏓  Ping Pong Multiplayer Server');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://192.168.1.194:${PORT}`);
  console.log('───────────────────────────────────────────────');
  console.log('  Share the Network URL with the other player.');
  console.log('  Watching for connections...');
  console.log('═══════════════════════════════════════════════');
});