#!/usr/bin/env node
/* Sends one test email through the mailer:  node scripts/mail-test.js recipient@example.com */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { sendMail, isConfigured } = require('../src/services/mail/mailer');

const to = process.argv[2];
if (!to) { console.error('usage: node scripts/mail-test.js recipient@example.com'); process.exit(1); } // eslint-disable-line no-console
if (!isConfigured()) { console.error('Not configured: need MAIL_ID, CLIENT_ID, CLIENT_SECRET and GMAIL_REFRESH_TOKEN (run scripts/gmail-oauth-token.js first).'); process.exit(1); } // eslint-disable-line no-console

sendMail({ to, subject: 'Santulan mail test', text: 'This is a test email from the Santulan backend. If you can read it, real email sending works.' })
  .then((r) => console.log('sent, message id', r.id)) // eslint-disable-line no-console
  .catch((e) => { console.error(e.message); process.exit(1); }); // eslint-disable-line no-console
