const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { getRateForNumber } = require('../services/rateService');
const { makeCall, buildInboundXml, buildDialXml } = require('../services/atService');

const router = express.Router();

/**
 * POST /calls/outbound
 * Pre-flight: check wallet balance, create call_log row, initiate AT call.
 * Body: { to: "+2348012345678" }
 */
router.post('/outbound', auth, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Destination number (to) is required' });

  try {
    // 1. Check wallet balance
    const walletRes = await pool.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1', [req.user.id]
    );
    if (!walletRes.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    const wallet = walletRes.rows[0];

    // 2. Get rate for destination
    const rate = await getRateForNumber(to);
    if (Number(wallet.balance) < rate) {
      return res.status(402).json({ error: 'Insufficient balance', balance: wallet.balance, rate });
    }

    // 3. Get user's virtual number
    const numberRes = await pool.query(
      "SELECT phone_number FROM numbers WHERE user_id = $1 AND status = 'active' LIMIT 1",
      [req.user.id]
    );
    const fromNumber = numberRes.rows[0]?.phone_number || process.env.AT_CALLER_ID;

    // 4. Create call_log row
    const logRes = await pool.query(
      `INSERT INTO call_logs (user_id, from_number, to_number, direction, rate_per_minute, status)
       VALUES ($1, $2, $3, 'outbound', $4, 'in-progress') RETURNING id`,
      [req.user.id, fromNumber, to, rate]
    );
    const callLogId = logRes.rows[0].id;

    // 5. Ask Africa's Talking to initiate the call
    //    AT will call the user's number, then fire /calls/voice for XML instructions
    const atResult = await makeCall(to, fromNumber);

    // Store AT sessionId for later matching in the callback
    await pool.query(
      'UPDATE call_logs SET provider_call_sid = $1 WHERE id = $2',
      [atResult.sessionId, callLogId]
    );

    res.json({
      allowed: true,
      rate,
      call_log_id: callLogId,
      session_id: atResult.sessionId,
      balance: wallet.balance,
    });
  } catch (err) {
    console.error('[calls/outbound]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /calls/voice  (Africa's Talking voice callback)
 * AT fires this URL when a call connects and needs XML instructions.
 * AT POST body includes: isActive, callerNumber, destinationNumber, sessionId,
 *                        callSessionState, direction, durationInSeconds, etc.
 *
 * Register this URL in AT Dashboard → Voice → Settings → Voice Callback URL
 */
router.post('/voice', express.urlencoded({ extended: false }), async (req, res) => {
  const {
    callerNumber,
    destinationNumber,
    sessionId,
    direction,       // 'Outbound' | 'Inbound'
    isActive,        // '1' while call is live, '0' when it ends
    durationInSeconds,
    callSessionState, // 'Initiated', 'Ringing', 'Active', 'Transferred', 'TransferComplete',
                      // 'CallRejected', 'NoAnswer', 'Cancelled', 'Completed', 'Failed', etc.
  } = req.body;

  // ── Call ended: bill the user ─────────────────────────────────────────────
  if (isActive === '0' || callSessionState === 'Completed' || callSessionState === 'CallRejected') {
    await billCall(sessionId, callSessionState, parseInt(durationInSeconds || '0', 10));
    // AT expects a 200 with empty XML body on terminal events
    res.set('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  // ── Active call: return dial instructions ─────────────────────────────────
  if (direction === 'Outbound' && destinationNumber) {
    res.set('Content-Type', 'text/xml');
    return res.send(buildDialXml(destinationNumber, callerNumber, sessionId));
  }

  // ── Inbound call to our number ────────────────────────────────────────────
  res.set('Content-Type', 'text/xml');
  res.send(buildInboundXml());
});

/**
 * POST /calls/status  (Africa's Talking notification URL — optional)
 * AT also supports a separate notificationUrl for final call records.
 * We handle billing in /calls/voice above, but this is a safe fallback.
 */
router.post('/status', express.urlencoded({ extended: false }), async (req, res) => {
  const { sessionId, callSessionState, durationInSeconds } = req.body;
  if (callSessionState === 'Completed') {
    await billCall(sessionId, callSessionState, parseInt(durationInSeconds || '0', 10));
  }
  res.status(200).send();
});

/**
 * Shared billing logic — deducts cost from wallet after call ends.
 */
async function billCall(sessionId, finalStatus, durationSeconds) {
  if (!sessionId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logRes = await client.query(
      'SELECT * FROM call_logs WHERE provider_call_sid = $1 FOR UPDATE',
      [sessionId]
    );
    if (!logRes.rows.length) { await client.query('ROLLBACK'); return; }

    const log = logRes.rows[0];
    if (log.status === 'completed') { await client.query('ROLLBACK'); return; } // already billed

    const minutes = Math.ceil(durationSeconds / 60);
    const cost    = minutes * Number(log.rate_per_minute);
    const status  = finalStatus === 'Completed' ? 'completed' : 'failed';

    await client.query(
      `UPDATE call_logs
       SET duration_seconds = $1, cost = $2, status = $3
       WHERE id = $4`,
      [durationSeconds, cost, status, log.id]
    );

    if (cost > 0) {
      const wRes = await client.query(
        'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [log.user_id]
      );
      const w = wRes.rows[0];
      const newBal = Math.max(0, Number(w.balance) - cost);
      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBal, w.id]
      );
      await client.query(
        `INSERT INTO transactions (wallet_id, type, amount, reference, metadata)
         VALUES ($1, 'call_debit', $2, $3, $4)`,
        [w.id, cost, sessionId,
         JSON.stringify({ call_log_id: log.id, duration_seconds: durationSeconds })]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[billCall]', err.message);
  } finally {
    client.release();
  }
}

/**
 * GET /calls/logs
 */
router.get('/logs', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM call_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ calls: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
