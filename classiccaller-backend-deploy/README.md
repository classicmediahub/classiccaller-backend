# Classic Caller Backend

VoIP-based virtual number platform: register, get a virtual phone number, recharge a wallet, and make/receive calls via WebRTC — billed per minute from the wallet balance.

## Stack
- Node.js + Express
- PostgreSQL
- Twilio (Voice, virtual numbers, WebRTC SDK tokens)

## Setup

1. Install dependencies
   ```
   npm install
   ```

2. Create a PostgreSQL database and run the migration:
   ```
   psql $DATABASE_URL -f migrations/001_init.sql
   ```

3. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`)
   - `TWILIO_TWIML_APP_SID` — create a TwiML App in Twilio console, point its Voice Request URL to `${BASE_URL}/calls/voice`
   - `BASE_URL` — your public backend URL (use ngrok for local dev so Twilio webhooks can reach you)

4. Run:
   ```
   npm run dev
   ```

## API Overview

### Auth
- `POST /auth/register` — { email, password, full_name }
- `POST /auth/login` — { email, password }

### Numbers
- `POST /numbers/provision` — { country: "US" } — buys a Twilio number for the user (auth required)
- `GET /numbers/me` — list user's numbers
- `GET /numbers/voice-token` — Twilio Voice SDK access token for WebRTC calling

### Wallet
- `GET /wallet/balance`
- `POST /wallet/recharge` — { amount, reference } — **wire this to a payment webhook in production, not directly to the client**
- `GET /wallet/transactions`

### Calls
- `POST /calls/outbound` — { to } — pre-flight check: validates balance, returns rate + call_log_id
- `POST /calls/voice` — Twilio TwiML webhook (inbound + outbound call routing)
- `POST /calls/status` — Twilio status callback, computes cost and debits wallet
- `GET /calls/logs` — call history

## Frontend integration (outline)

1. User logs in, gets JWT.
2. Call `GET /numbers/voice-token` → get Twilio Voice access token.
3. Initialize `Twilio.Device` (twilio-client / @twilio/voice-sdk) with that token.
4. Before dialing, call `POST /calls/outbound` with `{ to }` to check balance and get `call_log_id`.
5. Place the call: `device.connect({ params: { To: to, callLogId: call_log_id } })`.
6. Twilio hits `/calls/voice` to get TwiML, dials out, then hits `/calls/status` on completion — wallet is debited automatically.

## Compliance note

Reselling phone numbers / call termination is regulated in most jurisdictions (e.g. NCC licensing in Nigeria). Confirm licensing requirements before launching publicly. "eSIM" here refers to an app-based virtual number (VoIP), not a GSM eSIM profile — issuing real cellular eSIMs requires MNO/MVNO agreements and GSMA SM-DP+ infrastructure.
