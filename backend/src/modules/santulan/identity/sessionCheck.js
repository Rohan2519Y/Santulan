/*
 * Per-request session re-checks (BUILD 08 B08-008, SEC-29). The middleware calls these on every request so a suspended
 * participant or admin, or a token minted before a password reset, loses access immediately. Runs under the SYSTEM scope
 * (the session is not yet a scope); nothing here trusts request input.
 */
const store = require('../store');
const identity = require('../store/repositories/identity');
const devIdentity = require('../store/repositories/devIdentity');
const { credentialVersion } = require('./devProvider');

/** { status, authProvider, authProviderSubjectId, credential } for a participant, or null. */
async function participantSession(participantId) {
  return store.withScope(store.systemScope(), async (tx) => {
    const p = await identity.getParticipant(tx, participantId);
    if (!p) return null;
    const credential = p.authProvider && p.authProviderSubjectId ? await devIdentity.findCredential(tx, p.authProvider, p.authProviderSubjectId) : null;
    return { status: p.status, authProvider: p.authProvider, authProviderSubjectId: p.authProviderSubjectId, credential };
  });
}

/** The credential-version fingerprint a valid `pv` claim must equal (only an active, non-temporary credential has one). */
function currentVersion(session) {
  const c = session.credential;
  return c && c.status === 'active' && !c.mustChange ? credentialVersion(c.updatedAt) : null;
}

async function adminSession(adminUserId) {
  return store.withScope(store.systemScope(), (tx) => identity.getAdmin(tx, adminUserId));
}

module.exports = { participantSession, currentVersion, adminSession };
