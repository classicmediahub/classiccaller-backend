const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /wallet/balance
router.get('/balance', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT balance, currency FROM wallets WHERE user_id = $1', [
      req.user.id,
    ]);
    if (!result.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /wallet/recharge
// In production this is called by a payment webhook (Stripe/Paystack/Flutterwave)
// after confirming payment, NOT directly by the client.
router.post('/recharge', auth, async (req, res) => {
  const { amount, reference } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );
    if (!walletRes.rows.length) throw new Error('Wallet not found');

    const wallet = walletRes.rows[0];

    await client.query('UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE id = $2', [
      amount,
      wallet.id,
    ]);

    await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, reference)
       VALUES ($1, 'recharge', $2, $3)`,
      [wallet.id, amount, reference || null]
    );

    await client.query('COMMIT');

    res.json({ success: true, newBalance: Number(wallet.balance) + Number(amount) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Recharge failed', details: err.message });
  } finally {
    client.release();
  }
});

// GET /wallet/transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.* FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.user_id = $1
       ORDER BY t.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
