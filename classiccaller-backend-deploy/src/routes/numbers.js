const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { getVirtualNumber } = require('../services/atService');

const router = express.Router();

/**
 * POST /numbers/provision
 * Assigns the configured AT virtual number to the user.
 * In Sandbox: uses AT_CALLER_ID from .env (the sandbox sim number).
 * In Live: same — numbers are purchased via AT dashboard, then set in .env.
 */
router.post('/provision', auth, async (req, res) => {
  try {
    const existing = await pool.query(
      "SELECT id FROM numbers WHERE user_id = $1 AND status = 'active'",
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already has an active number' });
    }

    const { phoneNumber, providerSid } = await getVirtualNumber();

    const result = await pool.query(
      `INSERT INTO numbers (user_id, phone_number, provider_sid, country)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, phoneNumber, providerSid, 'NG']
    );

    res.status(201).json({ number: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to provision number', details: err.message });
  }
});

// GET /numbers/me
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM numbers WHERE user_id = $1', [req.user.id]
    );
    res.json({ numbers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
