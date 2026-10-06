/*
 * Real email through the Gmail API with OAuth2 (Google Cloud OAuth client; no app password). Only the narrow `gmail.send`
 * scope is used, so the token can send mail but cannot read the mailbox. Configuration (env): MAIL_ID (the sending Gmail
 * address), CLIENT_ID and CLIENT_SECRET (the OAuth client; read from backend/.env or the repository root .env), and
 * GMAIL_REFRESH_TOKEN (written by scripts/gmail-oauth-token.js). When any is missing the mailer reports "not configured" and
 * callers fall back to the dev behaviour (logging), so nothing breaks without it.
 *
 * Note: while the Google app is in Testing mode, the refresh token expires after 7 days; re-run scripts/gmail-oauth-token.js.
 */
const path = require('path');
const MailComposer = require('nodemailer/lib/mail-composer');

// The OAuth client id/secret live in the repository root .env; load it without overriding anything already set.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const settings = () => ({ from: process.env.MAIL_ID, clientId: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN });
const isConfigured = () => Object.values(settings()).every(Boolean);

let cached = null; // { token, expiresAt }
async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const s = settings();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error === 'invalid_grant' ? 'the Google refresh token is no longer valid (Testing-mode tokens expire after 7 days): run scripts/gmail-oauth-token.js again' : (data.error_description || data.error || res.status);
    throw new Error(`Mail: could not get a Google access token - ${reason}`);
  }
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3000) * 1000 };
  return cached.token;
}

/** Sends one email. Returns { id }. Throws if not configured or Google refuses. */
async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) throw new Error('Mail is not configured (MAIL_ID, CLIENT_ID, CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  const raw = await new Promise((resolve, reject) => new MailComposer({ from: `Santulan <${settings().from}>`, to, subject, text, html }).compile().build((e, buf) => (e ? reject(e) : resolve(buf))));
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url') }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mail: Gmail refused the message - ${(data.error && data.error.message) || res.status}`);
  return { id: data.id };
}

module.exports = { sendMail, isConfigured };
