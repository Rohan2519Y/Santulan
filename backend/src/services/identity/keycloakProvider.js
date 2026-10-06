/*
 * Keycloak adapter for the current Santulan email/Santulan-ID + password experience. Keycloak owns password hashes;
 * Santulan keeps only its opaque provider subject. The adapter is inert until IDENTITY_PROVIDER=keycloak is configured.
 */
const crypto = require('crypto');
const config = require('../../config');

const PROVIDER = 'keycloak';
const passwordProblem = (password) => {
  if (typeof password !== 'string' || password.length < 10) return 'at least 10 characters';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) return 'uppercase and lowercase letters and digits';
  return null;
};

const temporaryPassword = () => `${crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}7A`;
const form = (values) => new URLSearchParams(values).toString();

function createKeycloakProvider({ fetchImpl = fetch, settings = config.keycloak } = {}) {
  const required = ['baseUrl', 'realm', 'clientId', 'clientSecret'];
  if (required.some((key) => !settings[key])) throw new Error('Keycloak is not configured');
  const realmUrl = `${settings.baseUrl}/realms/${encodeURIComponent(settings.realm)}`;
  const adminUrl = `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}`;

  async function request(url, options = {}) {
    const res = await fetchImpl(url, options);
    if (!res.ok) throw new Error(`Keycloak request failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }

  async function token(grant) {
    return request(`${realmUrl}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: settings.clientId, client_secret: settings.clientSecret, ...grant }),
    });
  }

  async function adminToken() { return token({ grant_type: 'client_credentials' }); }
  async function admin(path, options = {}) {
    const access = await adminToken();
    return request(`${adminUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${access.access_token}`, ...(options.headers || {}) } });
  }
  async function user(subject) {
    const rows = await admin(`/users?username=${encodeURIComponent(subject)}&exact=true`);
    return rows[0] || null;
  }
  async function reset(id, password) {
    await admin(`/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    });
  }
  async function setState(id, mustChange) {
    const updatedAt = new Date();
    await admin(`/users/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requiredActions: [], attributes: { santulanMustChange: [String(mustChange)], santulanCredentialVersion: [String(updatedAt.getTime())] } }),
    });
    return updatedAt;
  }
  async function create(subject, password, mustChange) {
    const email = subject.includes('@') ? subject : `${subject}@identity.santulan.invalid`;
    const access = await adminToken();
    const res = await fetchImpl(`${adminUrl}/users`, {
      method: 'POST', headers: { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: subject, email, emailVerified: true, firstName: 'Santulan', lastName: 'Participant', enabled: true,
        requiredActions: [], credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    });
    if (!res.ok) throw new Error(`Keycloak user creation failed (${res.status})`);
    const id = res.headers.get('location')?.split('/').pop();
    if (!id) throw new Error('Keycloak did not return a user identifier');
    const updatedAt = await setState(id, mustChange);
    return { ok: true, updatedAt };
  }

  return {
    PROVIDER, passwordProblem,
    async authenticate(subject, password) {
      try { await token({ grant_type: 'password', username: subject, password }); } catch (_) { return { ok: false, mustChange: false }; }
      const found = await user(subject);
      const attrs = found?.attributes || {};
      return { ok: Boolean(found?.enabled), mustChange: attrs.santulanMustChange?.[0] === 'true', updatedAt: new Date(Number(attrs.santulanCredentialVersion?.[0]) || Date.now()) };
    },
    createOwnPassword(subject, password) { const problem = passwordProblem(password); return problem ? Promise.resolve({ ok: false, problem }) : create(subject, password, false); },
    async issueTemporaryCredential(subject) { const password = temporaryPassword(); await this.provisionTemporaryCredential(subject, password); return password; },
    async provisionTemporaryCredential(subject, password) { const found = await user(subject); if (found) { await reset(found.id, password); await setState(found.id, true); } else await create(subject, password, true); },
    async setPassword(subject, password) { const problem = passwordProblem(password); if (problem) return { ok: false, problem }; const found = await user(subject); if (!found || found.attributes?.santulanMustChange?.[0] !== 'true') return { ok: false, problem: 'no temporary credential to replace' }; await reset(found.id, password); const updatedAt = await setState(found.id, false); return { ok: true, updatedAt }; },
    async revoke(subject) { const found = await user(subject); if (found) await admin(`/users/${encodeURIComponent(found.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }); },
    async requestPasswordReset(subject) { return this.issueTemporaryCredential(subject); },
    async credentialUpdatedAt(subject) { const found = await user(subject); const version = found?.attributes?.santulanCredentialVersion?.[0]; return version ? new Date(Number(version)) : null; },
  };
}

module.exports = { createKeycloakProvider, PROVIDER, passwordProblem };
