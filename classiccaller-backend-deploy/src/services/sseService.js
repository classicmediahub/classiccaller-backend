const { Pool, Client } = require('pg');
require('dotenv').config();

// ─── SSE connection registry ──────────────────────────────────────────────────
// Map<userId, Set<res>> — one user can have multiple tabs open
const connections = new Map();

function addConnection(userId, res) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(res);
}

function removeConnection(userId, res) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) connections.delete(userId);
}

function pushToUser(userId, payload) {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      set.delete(res);
    }
  }
}

// ─── Dedicated Postgres LISTEN client ────────────────────────────────────────
// We use a raw Client (not pool) for LISTEN — pools don't support it.
let pgListener = null;
const listenedChannels = new Set();

async function ensureListener() {
  if (pgListener) return pgListener;

  pgListener = new Client({ connectionString: process.env.DATABASE_URL });
  await pgListener.connect();

  pgListener.on('notification', (msg) => {
    // Channel is "user_{id}"
    const match = msg.channel.match(/^user_(\d+)$/);
    if (!match) return;
    const userId = parseInt(match[1], 10);
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }
    pushToUser(userId, payload);
  });

  pgListener.on('error', async (err) => {
    console.error('[SSE] Postgres listener error:', err.message);
    pgListener = null;
    // Reconnect after 3 s
    setTimeout(ensureListener, 3000);
  });

  return pgListener;
}

// Start listening on the channel for a given user (idempotent)
async function subscribeUser(userId) {
  const channel = `user_${userId}`;
  if (listenedChannels.has(channel)) return;
  const client = await ensureListener();
  await client.query(`LISTEN "${channel}"`);
  listenedChannels.add(channel);
}

// ─── Express SSE route handler ────────────────────────────────────────────────
// Mount as:  app.get('/events', auth, sseHandler)
async function sseHandler(req, res) {
  const userId = req.user.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable proxy buffering
  res.flushHeaders();

  // Initial heartbeat so the browser knows we're open
  res.write(': connected\n\n');

  // Heartbeat every 20 s to keep proxies from closing idle connections
  const hbInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 20000);

  addConnection(userId, res);
  await subscribeUser(userId);

  req.on('close', () => {
    clearInterval(hbInterval);
    removeConnection(userId, res);
  });
}

module.exports = { sseHandler, pushToUser };
