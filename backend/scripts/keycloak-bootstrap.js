#!/usr/bin/env node
/* Creates the least-privilege Keycloak client used by the Santulan backend. Never prints client secrets. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootEnv = path.resolve(__dirname, '..', '..', '.env');
const env = { ...dotenv.parse(fs.readFileSync(rootEnv)), ...process.env };
const baseUrl = (env.KEYCLOAK_PUBLIC_BASE_URL || `http://127.0.0.1:${env.KEYCLOAK_PORT || '8081'}`).replace(/\/$/, '');
const realm = env.KEYCLOAK_REALM || 'santulan';
const clientId = env.KEYCLOAK_CLIENT_ID || 'santulan-backend';
const adminUser = env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = env.KEYCLOAK_ADMIN_PASSWORD;

if (!adminUser || !adminPassword) throw new Error('KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD are required in the root .env');

const request = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Keycloak request failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};
const form = (values) => new URLSearchParams(values).toString();

async function main() {
  const token = await request(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'password', client_id: 'admin-cli', username: adminUser, password: adminPassword }),
  });
  const admin = (suffix, options = {}) => request(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}${suffix}`, {
    ...options, headers: { Authorization: `Bearer ${token.access_token}`, ...(options.headers || {}) },
  });

  let [client] = await admin(`/clients?clientId=${encodeURIComponent(clientId)}`);
  if (!client) {
    await admin('/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, protocol: 'openid-connect', enabled: true, publicClient: false, directAccessGrantsEnabled: true, serviceAccountsEnabled: true, standardFlowEnabled: false, fullScopeAllowed: false }),
    });
    [client] = await admin(`/clients?clientId=${encodeURIComponent(clientId)}`);
  }
  await admin(`/clients/${client.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...client, fullScopeAllowed: false, directAccessGrantsEnabled: true, serviceAccountsEnabled: true, standardFlowEnabled: false }),
  });
  const serviceAccount = await admin(`/clients/${client.id}/service-account-user`);
  const [realmManagement] = await admin('/clients?clientId=realm-management');
  const roles = await Promise.all(['manage-users', 'query-users', 'view-users'].map((name) => admin(`/clients/${realmManagement.id}/roles/${name}`)));
  await admin(`/clients/${client.id}/scope-mappings/clients/${realmManagement.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roles),
  });
  await admin(`/users/${serviceAccount.id}/role-mappings/clients/${realmManagement.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roles),
  });
  const profile = await admin('/users/profile');
  await admin('/users/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profile, unmanagedAttributePolicy: 'ADMIN_EDIT' }),
  });
  const actions = await admin('/authentication/required-actions');
  const verifyProfile = actions.find((action) => action.alias === 'VERIFY_PROFILE');
  if (verifyProfile) {
    await admin('/authentication/required-actions/VERIFY_PROFILE', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...verifyProfile, enabled: false, defaultAction: false }),
    });
  }
  const secret = await admin(`/clients/${client.id}/client-secret`);
  const line = `KEYCLOAK_CLIENT_SECRET="${secret.value}"`;
  const text = fs.readFileSync(rootEnv, 'utf8');
  fs.writeFileSync(rootEnv, /^KEYCLOAK_CLIENT_SECRET=.*$/m.test(text) ? text.replace(/^KEYCLOAK_CLIENT_SECRET=.*$/m, line) : `${text.trim()}\n${line}\n`);
  console.log(`Keycloak client "${clientId}" is ready; its secret was saved to the root .env.`); // eslint-disable-line no-console
}

main().catch((err) => { console.error(err.message); process.exit(1); }); // eslint-disable-line no-console
