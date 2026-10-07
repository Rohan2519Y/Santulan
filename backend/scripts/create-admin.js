#!/usr/bin/env node
/*
 * Creates the FIRST real SUPER_ADMIN for a staging or production deployment (audit gap G-15). The dev seeders, with their fixed
 * documented passwords, refuse to run anywhere except development and test; this is the supported way to get an admin elsewhere.
 *
 *   node scripts/create-admin.js --subject <login subject> [--provider keycloak|dev]
 *
 *  - keycloak (the managed provider): --subject is the user's Keycloak id (`sub`). The password and any second step live in
 *    Keycloak; this only links that identity to an admin row. No password is created or printed here.
 *  - dev (staging with the built-in dev login; refused in production): a one-time temporary password is generated, printed
 *    ONCE and must be changed at first sign-in.
 * Refuses when the account already exists. Writes an audit row. APP_ENV must be set explicitly. Run on the server, by hand.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { v4: uuidv4 } = require('uuid');
const store = require('../src/models/db');
const identity = require('../src/models/repositories/identity');
const { writeAudit } = require('../src/services/audit/auditService');
const config = require('../src/config');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const env = (process.env.APP_ENV || '').trim();
  if (!['development', 'test', 'staging', 'production'].includes(env)) throw new Error('APP_ENV must be set explicitly (development, test, staging or production).');
  const subject = (arg('subject') || '').trim();
  if (subject.length < 3) throw new Error('usage: node scripts/create-admin.js --subject <login subject> [--provider keycloak|dev]');
  const providerName = arg('provider') || config.identityProvider;
  if (!['keycloak', 'dev'].includes(providerName)) throw new Error('--provider must be keycloak or dev');
  if (providerName === 'dev' && env === 'production') throw new Error('The dev identity provider must not be used in production.');
  const { getProvider } = require('../src/services/identity');
  const provider = providerName === 'dev' ? getProvider() : null; // the dev provider issues the temporary password below
  const authProvider = providerName === 'dev' ? provider.PROVIDER : 'keycloak';

  let temporaryPassword = null;
  const adminId = await store.withScope(store.systemScope(), async (tx) => {
    if (await identity.findAdminByAuthSubject(tx, authProvider, subject)) throw new Error('An admin with that subject already exists; nothing was changed.');
    const now = new Date();
    const admin = await identity.insertAdmin(tx, { _id: uuidv4(), role: 'SUPER_ADMIN', auth_provider: authProvider, auth_provider_subject_id: subject, status: 'ACTIVE', created_at: now, updated_at: now });
    await writeAudit(tx, { actorType: 'SYSTEM', actorId: null, actionType: 'ADMIN_CREATED', targetEntity: 'admin_users', targetId: admin.adminUserId, newState: { role: 'SUPER_ADMIN', provider: authProvider }, correlationId: null });
    return admin.adminUserId;
  }, { transaction: true });
  if (providerName === 'dev') temporaryPassword = await provider.issueTemporaryCredential(subject);

  console.log(`Created SUPER_ADMIN ${adminId} (provider ${authProvider}, subject ${subject}).`); // eslint-disable-line no-console
  if (temporaryPassword) console.log(`One-time temporary password (shown once, change it at first sign-in): ${temporaryPassword}`); // eslint-disable-line no-console
  else console.log('Sign in through the identity provider; set the password and any second step there.'); // eslint-disable-line no-console
}

main().catch((err) => { console.error(err.message || err); process.exitCode = 1; }).finally(() => store.closeClient());
