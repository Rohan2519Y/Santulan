#!/usr/bin/env node
/*
 * One-time Google sign-in that obtains the refresh token the mailer needs (scope: gmail.send only).
 *
 *   node scripts/gmail-oauth-token.js
 *
 * Prerequisites (Google Cloud Console): Gmail API enabled; consent screen has the gmail.send scope and the sending account as
 * a test user; the OAuth client lists http://localhost:5055/oauth2callback as an authorised redirect URI.
 * It opens (prints) a Google link; sign in as the sending account and approve. The refresh token is written to backend/.env as
 * GMAIL_REFRESH_TOKEN and is never printed. While the app is in Testing mode the token lasts 7 days - run this again then.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const ENV_FILE = path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: ENV_FILE });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const PORT = 5055;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const { CLIENT_ID, CLIENT_SECRET, MAIL_ID } = process.env;
if (!CLIENT_ID || !CLIENT_SECRET) { console.error('CLIENT_ID / CLIENT_SECRET not found in backend/.env or the root .env'); process.exit(1); } // eslint-disable-line no-console

const state = require('crypto').randomBytes(16).toString('hex');
const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.send',
  access_type: 'offline', prompt: 'consent', state, ...(MAIL_ID ? { login_hint: MAIL_ID } : {}),
})}`;

function saveToken(token) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `GMAIL_REFRESH_TOKEN="${token}"`;
  text = /^GMAIL_REFRESH_TOKEN=.*$/m.test(text) ? text.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, text);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return; }
  const done = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); server.close(); };
  if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) return done(400, `Sign-in failed: ${u.searchParams.get('error') || 'invalid response'}`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.refresh_token) { console.error('Google did not return a refresh token:', data.error_description || data.error || r.status); return done(500, 'No refresh token was returned. See the terminal.'); } // eslint-disable-line no-console
  saveToken(data.refresh_token);
  console.log(`GMAIL_REFRESH_TOKEN="${data.refresh_token}"`); // eslint-disable-line no-console
  console.log('Refresh token saved to backend/.env. Treat the terminal output as a secret.'); // eslint-disable-line no-console
  return done(200, 'Done. You can close this tab and return to the terminal.');
});
server.listen(PORT, () => {
  console.log('Open this link in your browser and sign in as the sending account:\n\n' + url + '\n'); // eslint-disable-line no-console
  exec(`start "" "${url}"`, () => {});
});
