require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes      = require('./routes/auth');
const numberRoutes    = require('./routes/numbers');
const walletRoutes    = require('./routes/wallet');
const callRoutes      = require('./routes/calls');
const paystackRoutes  = require('./routes/paystack');
const auth            = require('./middleware/auth');
const { sseHandler }  = require('./services/sseService');

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ⚠️ Paystack webhook needs raw body BEFORE express.json() parses it
app.use('/paystack/webhook', express.raw({ type: 'application/json' }));

// AT webhooks need urlencoded
app.use('/calls/voice',  express.urlencoded({ extended: false }));
app.use('/calls/status', express.urlencoded({ extended: false }));

app.use(express.json());

app.get('/health', (req, res) =>
  res.json({ status: 'ok', provider: "Africa's Talking", env: process.env.NODE_ENV })
);

// Real-time SSE
app.get('/events', auth, sseHandler);

app.use('/auth',      authRoutes);
app.use('/numbers',   numberRoutes);
app.use('/wallet',    walletRoutes);
app.use('/calls',     callRoutes);
app.use('/paystack',  paystackRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Classic Caller backend running on port ${PORT}`)
);
