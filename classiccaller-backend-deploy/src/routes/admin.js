/**
 * admin.js — one-time fix endpoints
 * These run database fixes without needing Shell access
 * DELETE these routes after use for security
 */
const express = require('express');
const pool = require('../config/db');
const router = express.Router();

// GET /admin/fix-currency?secret=classiccaller2024
// Updates all wallets from USD to NGN
router.get('/fix-currency', async (req, res) => {
  const { secret } = req.query;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query("UPDATE wallets SET currency = 'NGN'");
    res.json({ success: true, updated: result.rowCount, message: `${result.rowCount} wallets updated to NGN` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/status?secret=classiccaller2024
// Check current wallet currencies
router.get('/status', async (req, res) => {
  const { secret } = req.query;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const wallets = await pool.query('SELECT id, user_id, balance, currency FROM wallets');
    const users = await pool.query('SELECT id, email FROM users');
    res.json({ wallets: wallets.rows, users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
