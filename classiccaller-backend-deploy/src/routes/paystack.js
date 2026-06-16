/**
 * paystack.js — Paystack payment integration
 *
 * Flow:
 * 1. Frontend calls POST /paystack/initialize → gets a payment URL
 * 2. User pays on Paystack checkout page
 * 3. Paystack sends webhook to POST /paystack/webhook → we verify + credit wallet
 * 4. Frontend polls GET /paystack/verify/:reference to confirm payment
 */

const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

// ── Helper: call Paystack API ─────────────────────────────────────────────────
async function paystackRequest(method, path, body) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Helper: credit wallet (shared with webhook + verify) ─────────────────────
async function creditWallet(userId, amountKobo, reference) {
  // Paystack amounts are in kobo (1 NGN = 100 kobo)
  // We store wallet in USD equivalent — convert at a fixed rate or store NGN
  // Here we store in NGN for simplicity (update currency to NGN in wallets)
  const amountNGN = amountKobo / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check this reference hasn't been processed already (idempotency)
    const existing = await client.query(
      "SELECT id FROM transactions WHERE reference = $1 AND type = 'recharge'",
      [reference]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { already: true };
    }

    const walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!walletRes.rows.length) throw new Error('Wallet not found');
    const wallet = walletRes.rows[0];

    await client.query(
      'UPDATE wallets SET balance = balance + $1, currency = $2, updated_at = NOW() WHERE id = $3',
      [amountNGN, 'NGN', wallet.id]
    );

    await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, reference, metadata)
       VALUES ($1, 'recharge', $2, $3, $4)`,
      [wallet.id, amountNGN, reference,
       JSON.stringify({ provider: 'paystack', amount_kobo: amountKobo })]
    );

    await client.query('COMMIT');
    return { credited: true, amount: amountNGN };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /paystack/initialize
// Frontend calls this to get a Paystack checkout URL
// Body: { amount_ngn: 1000 }  (amount in NGN, e.g. 1000 = ₦1,000)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/initialize', auth, async (req, res) => {
  const { amount_ngn } = req.body;

  if (!amount_ngn || amount_ngn < 100) {
    return res.status(400).json({ error: 'Minimum recharge is ₦100' });
  }

  try {
    // Get user email for Paystack
    const userRes = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const reference = `cc_${req.user.id}_${Date.now()}`;
    const amountKobo = Math.round(amount_ngn * 100); // convert to kobo

    const data = await paystackRequest('POST', '/transaction/initialize', {
      email: user.email,
      amount: amountKobo,
      reference,
      currency: 'NGN',
      callback_url: `${process.env.FRONTEND_URL}/recharge?ref=${reference}`,
      metadata: {
        user_id: req.user.id,
        full_name: user.full_name,
        custom_fields: [
          { display_name: 'User ID', variable_name: 'user_id', value: String(req.user.id) },
          { display_name: 'App', variable_name: 'app', value: 'Classic Caller' },
        ],
      },
    });

    if (!data.status) {
      return res.status(500).json({ error: data.message || 'Paystack initialization failed' });
    }

    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      access_code: data.data.access_code,
    });
  } catch (err) {
    console.error('[paystack/initialize]', err.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /paystack/verify/:reference
// Called by frontend after redirect back from Paystack checkout
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify/:reference', auth, async (req, res) => {
  const { reference } = req.params;

  try {
    const data = await paystackRequest('GET', `/transaction/verify/${reference}`);

    if (!data.status || data.data?.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful', status: data.data?.status });
    }

    const tx = data.data;
    const result = await creditWallet(req.user.id, tx.amount, reference);

    if (result.already) {
      return res.json({ success: true, message: 'Already credited', already: true });
    }

    res.json({ success: true, amount_ngn: result.amount, reference });
  } catch (err) {
    console.error('[paystack/verify]', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /paystack/webhook
// Paystack calls this URL when payment is confirmed on their end.
// MUST be publicly accessible — set in Paystack Dashboard → Settings → Webhooks
// URL: https://classiccaller-backend.onrender.com/paystack/webhook
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // 1. Verify the request is genuinely from Paystack
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(req.body)
    .digest('hex');

  if (hash !== signature) {
    console.warn('[paystack/webhook] Invalid signature — possible spoofing attempt');
    return res.status(401).send('Invalid signature');
  }

  // 2. Parse event
  let event;
  try {
    event = JSON.parse(req.body);
  } catch {
    return res.status(400).send('Bad JSON');
  }

  // 3. Acknowledge immediately (Paystack needs a 200 within 5s)
  res.status(200).send('OK');

  // 4. Handle the event async
  if (event.event === 'charge.success') {
    const tx = event.data;
    const userId = tx.metadata?.user_id;

    if (!userId) {
      console.error('[paystack/webhook] No user_id in metadata', tx.reference);
      return;
    }

    try {
      const result = await creditWallet(parseInt(userId), tx.amount, tx.reference);
      if (result.already) {
        console.log(`[paystack/webhook] ${tx.reference} already credited — skipping`);
      } else {
        console.log(`[paystack/webhook] ✓ Credited ₦${result.amount} to user ${userId}`);
      }
    } catch (err) {
      console.error('[paystack/webhook] Credit failed:', err.message);
    }
  }
});

module.exports = router;
