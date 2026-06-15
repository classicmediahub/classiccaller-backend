const pool = require('../config/db');

/**
 * Find the best matching rate for a destination number based on prefix match.
 * Falls back to DEFAULT_RATE_PER_MINUTE if nothing matches.
 */
async function getRateForNumber(toNumber) {
  const result = await pool.query(
    `SELECT rate_per_minute FROM call_rates
     WHERE $1 LIKE destination_prefix || '%'
     ORDER BY LENGTH(destination_prefix) DESC LIMIT 1`,
    [toNumber]
  );

  if (result.rows.length) {
    return Number(result.rows[0].rate_per_minute);
  }

  return Number(process.env.DEFAULT_RATE_PER_MINUTE || 0.02);
}

module.exports = { getRateForNumber };
