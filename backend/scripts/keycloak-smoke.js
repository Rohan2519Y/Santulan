#!/usr/bin/env node
/* Exercises the Keycloak adapter with a disposable, disabled-at-end account. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createKeycloakProvider } = require('../src/services/identity/keycloakProvider');

const env = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '.env')));
const settings = {
  baseUrl: env.KEYCLOAK_PUBLIC_BASE_URL || `http://127.0.0.1:${env.KEYCLOAK_PORT || '8081'}`,
  realm: env.KEYCLOAK_REALM || 'santulan',
  clientId: env.KEYCLOAK_CLIENT_ID || 'santulan-backend',
  clientSecret: env.KEYCLOAK_CLIENT_SECRET,
};
const subject = `santulan-smoke-${Date.now()}@example.invalid`;
const firstPassword = 'Smoke-Password-42';
const finalPassword = 'Smoke-Password-84';

(async () => {
  const provider = createKeycloakProvider({ settings });
  const created = await provider.createOwnPassword(subject, firstPassword);
  if (!created.ok || !(await provider.authenticate(subject, firstPassword)).ok) throw new Error('Keycloak did not authenticate a created account');
  const temporary = await provider.issueTemporaryCredential(subject);
  const temporaryLogin = await provider.authenticate(subject, temporary);
  if (!temporaryLogin.ok || !temporaryLogin.mustChange) throw new Error('Temporary-credential flow failed');
  const updated = await provider.setPassword(subject, finalPassword);
  const finalLogin = await provider.authenticate(subject, finalPassword);
  if (!updated.ok || !finalLogin.ok || finalLogin.mustChange) throw new Error('Permanent-password flow failed');
  await provider.revoke(subject);
  if ((await provider.authenticate(subject, finalPassword)).ok) throw new Error('Disabled account authenticated');
  console.log('Keycloak adapter smoke check passed.'); // eslint-disable-line no-console
})().catch((err) => { console.error(err.message); process.exit(1); }); // eslint-disable-line no-console
