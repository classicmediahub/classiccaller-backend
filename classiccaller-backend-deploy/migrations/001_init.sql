-- Users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Wallets (one per user)
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(12,4) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Virtual numbers assigned to users
CREATE TABLE numbers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    provider_sid VARCHAR(64) NOT NULL,
    country VARCHAR(5),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Wallet transactions (recharge / debit history)
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER REFERENCES wallets(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'recharge', 'call_debit', 'refund'
    amount NUMERIC(12,4) NOT NULL,
    reference VARCHAR(128),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Call logs
CREATE TABLE call_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    from_number VARCHAR(20),
    to_number VARCHAR(20),
    direction VARCHAR(10), -- 'outbound' / 'inbound'
    provider_call_sid VARCHAR(64),
    duration_seconds INTEGER DEFAULT 0,
    rate_per_minute NUMERIC(8,4),
    cost NUMERIC(12,4) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'in-progress', -- in-progress, completed, failed
    created_at TIMESTAMP DEFAULT NOW()
);

-- Rate table for destination pricing
CREATE TABLE call_rates (
    id SERIAL PRIMARY KEY,
    destination_prefix VARCHAR(10) NOT NULL, -- e.g. '+234', '+1'
    rate_per_minute NUMERIC(8,4) NOT NULL,
    description VARCHAR(100)
);

CREATE INDEX idx_numbers_user ON numbers(user_id);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_call_logs_user ON call_logs(user_id);
