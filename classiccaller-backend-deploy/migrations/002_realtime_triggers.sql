-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: Real-time LISTEN/NOTIFY triggers
-- Run after 001_init.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Generic notifier: fires on INSERT or UPDATE, emits JSON payload on channel
-- "user_{user_id}" so the backend SSE handler only sends each user their own data.

-- ── Wallet change trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_wallet_change()
RETURNS trigger AS $$
DECLARE
  user_id_val INTEGER;
BEGIN
  SELECT user_id INTO user_id_val FROM wallets WHERE id = NEW.id;
  PERFORM pg_notify(
    'user_' || user_id_val::text,
    json_build_object(
      'type',    'WALLET_UPDATE',
      'balance', NEW.balance,
      'currency',NEW.currency
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_change ON wallets;
CREATE TRIGGER trg_wallet_change
  AFTER INSERT OR UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION notify_wallet_change();

-- ── Transaction trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_transaction()
RETURNS trigger AS $$
DECLARE
  user_id_val INTEGER;
BEGIN
  SELECT user_id INTO user_id_val FROM wallets WHERE id = NEW.wallet_id;
  PERFORM pg_notify(
    'user_' || user_id_val::text,
    json_build_object(
      'type',      'TRANSACTION',
      'tx_type',   NEW.type,
      'amount',    NEW.amount,
      'reference', NEW.reference,
      'created_at',NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction ON transactions;
CREATE TRIGGER trg_transaction
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION notify_transaction();

-- ── Call log trigger ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_call_log()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'user_' || NEW.user_id::text,
    json_build_object(
      'type',             'CALL_UPDATE',
      'call_id',          NEW.id,
      'status',           NEW.status,
      'direction',        NEW.direction,
      'to_number',        NEW.to_number,
      'from_number',      NEW.from_number,
      'duration_seconds', NEW.duration_seconds,
      'cost',             NEW.cost,
      'created_at',       NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_call_log ON call_logs;
CREATE TRIGGER trg_call_log
  AFTER INSERT OR UPDATE ON call_logs
  FOR EACH ROW EXECUTE FUNCTION notify_call_log();

-- ── Number provisioned trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_number()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'user_' || NEW.user_id::text,
    json_build_object(
      'type',         'NUMBER_UPDATE',
      'phone_number', NEW.phone_number,
      'country',      NEW.country,
      'status',       NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_number ON numbers;
CREATE TRIGGER trg_number
  AFTER INSERT OR UPDATE ON numbers
  FOR EACH ROW EXECUTE FUNCTION notify_number();
