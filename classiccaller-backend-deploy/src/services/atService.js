/**
 * atService.js — Africa's Talking voice + number service
 * Replaces twilioService.js
 *
 * Docs: https://developers.africastalking.com/docs/voice
 */

const AfricasTalking = require('africastalking');
require('dotenv').config();

// ── SDK init ──────────────────────────────────────────────────────────────────
const AT = AfricasTalking({
  username: process.env.AT_USERNAME,  // 'sandbox' for testing, your app name for live
  apiKey:   process.env.AT_API_KEY,
});

const voice = AT.VOICE;

/**
 * Initiate an outbound call from your virtual number to the destination.
 *
 * Africa's Talking calls YOU first (the callerId), then bridges to `to`.
 * For a WebRTC/browser dialer, use the callback flow instead:
 *   1. Browser hits POST /calls/outbound
 *   2. Backend calls AT.voice.call() → AT calls the user's registered SIP/phone
 *   3. AT fires the voiceCallbackUrl webhook to get call instructions (XML-like ActionScript)
 *
 * @param {string} to          - Destination in international format e.g. +2348012345678
 * @param {string} callerId    - Your AT virtual number e.g. +2349000000000
 * @returns {Promise<object>}  - AT API response
 */
async function makeCall(to, callerId) {
  const callerId_ = callerId || process.env.AT_CALLER_ID;

  const result = await voice.call({
    callFrom: callerId_,
    callTo:   [to],  // AT accepts an array for batch calling
  });

  // result.entries[0] looks like:
  // { phoneNumber: '+2348012345678', status: 'Queued', sessionId: 'ATVId_xxx' }
  const entry = result.entries?.[0];
  if (!entry || entry.status === 'Failed') {
    throw new Error(entry?.errorMessage || 'Africa\'s Talking call failed');
  }

  return entry; // { phoneNumber, status, sessionId }
}

/**
 * Get available virtual numbers for a country.
 * NOTE: In Sandbox, AT gives you a simulated number automatically.
 * In Live mode, number purchase is done via the dashboard or this API.
 *
 * Africa's Talking doesn't have a "buy number" REST API like Twilio —
 * numbers are provisioned via the dashboard. This function returns the
 * configured caller ID for now, and throws clearly if not set.
 */
async function getVirtualNumber() {
  const number = process.env.AT_CALLER_ID;
  if (!number) {
    throw new Error(
      'AT_CALLER_ID not set in .env. ' +
      'Go to Africa\'s Talking dashboard → Voice → Phone Numbers to get one, ' +
      'then set it here.'
    );
  }
  return {
    phoneNumber: number,
    providerSid: `at-${number.replace(/\D/g, '')}`, // synthetic SID for our DB
  };
}

/**
 * Generate Africa's Talking XML ActionScript for inbound call handling.
 * AT uses its own XML dialect (not TwiML).
 *
 * Called by GET/POST /calls/voice when AT fires the voice callback.
 * AT sends: isActive, callerNumber, destinationNumber, sessionId, etc.
 */
function buildInboundXml(message = "Welcome to Classic Caller. This number is not configured to receive calls yet.") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="en-US-Wavenet-F">${message}</Say>
  <Reject/>
</Response>`;
}

/**
 * Build XML to dial out to a PSTN number (for outbound call bridging).
 * AT fires the voiceCallbackUrl, we respond with this XML to connect the call.
 *
 * @param {string} to          - Number to dial e.g. +2348012345678
 * @param {string} callerId    - Your AT virtual number
 * @param {string} callLogId   - Our internal call log ID (passed as a custom header)
 */
function buildDialXml(to, callerId, callLogId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial record="false" sequential="true"
        callerId="${callerId || process.env.AT_CALLER_ID}"
        maxDuration="3600">
    <Number phoneNumber="${to}"/>
  </Dial>
</Response>`;
}

module.exports = { makeCall, getVirtualNumber, buildInboundXml, buildDialXml, voice };
