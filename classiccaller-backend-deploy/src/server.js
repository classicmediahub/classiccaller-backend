require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes     = require('./routes/auth');
const numberRoutes   = require('./routes/numbers');
const walletRoutes   = require('./routes/wallet');
const callRoutes     = require('./routes/calls');
const auth           = require('./middleware/auth');
const { sseHandler } = require('./services/sseService');

const app = express();

// Allow requests from Netlify frontend + local dev
const allowedOrigins = [
  process.env.FRONTEND_URL,          // e.g. https://classiccaller.netlify.app
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Raw body for Africa's Talking URL-encoded webhooks
app.use('/calls/voice',  express.urlencoded({ extended: false }));
app.use('/calls/status', express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) =>
  res.json({ status: 'ok', provider: "Africa's Talking", env: process.env.NODE_ENV })
);

// Real-time SSE — Postgres NOTIFY → browser push
app.get('/events', auth, sseHandler);

app.use('/auth',    authRoutes);
app.use('/numbers', numberRoutes);
app.use('/wallet',  walletRoutes);
app.use('/calls',   callRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Classic Caller backend running on port ${PORT}`)
);
