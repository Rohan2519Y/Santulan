/*
 * Scope (row-level-security replacement, database-contract section 5). A scope is a frozen object built ONLY from the
 * verified session (never from a request body, query or header), passed explicitly to every store call.
 *   PARTICIPANT       - sees only the participant's own data
 *   INSTITUTION_ADMIN - sees one institution's participants (exact, non-null institution id; OPEN participants never match)
 *   SUPER_ADMIN       - sees everything
 *   SYSTEM            - workers and verifiers (explicit; never derived from a request)
 *   NONE              - no scope: every read returns nothing and every write is refused
 */
const SCOPES = Object.freeze({ PARTICIPANT: 'PARTICIPANT', INSTITUTION_ADMIN: 'INSTITUTION_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN', SYSTEM: 'SYSTEM', NONE: 'NONE' });

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SIGNED = Symbol('santulan.store.scope');

const make = (fields) => {
  const scope = { actorScope: 'NONE', participantId: null, adminUserId: null, institutionId: null, ...fields };
  Object.defineProperty(scope, SIGNED, { value: true, enumerable: false });
  return Object.freeze(scope);
};

const NO_SCOPE = make({});

/** SYSTEM scope for workers, verifiers and boot-time tasks. */
const systemScope = () => make({ actorScope: SCOPES.SYSTEM });

/**
 * Builds a scope from the verified session (`req.user`) and, for an institution admin, the admin row loaded through the
 * access layer (never from the request). Anything not recognised yields NO_SCOPE.
 */
function buildScope(user, adminRow = null) {
  if (!user || typeof user !== 'object') return NO_SCOPE;
  if (user.role === 'participant' && UUID.test(String(user.participantId || ''))) {
    return make({ actorScope: SCOPES.PARTICIPANT, participantId: user.participantId });
  }
  if (user.role === 'admin' && UUID.test(String(user.adminUserId || '')) && adminRow) {
    if (adminRow.role === 'SUPER_ADMIN' && adminRow.status === 'ACTIVE') {
      return make({ actorScope: SCOPES.SUPER_ADMIN, adminUserId: user.adminUserId });
    }
    if (adminRow.role === 'INSTITUTION_ADMIN' && adminRow.status === 'ACTIVE' && typeof adminRow.institutionId === 'string' && adminRow.institutionId) {
      return make({ actorScope: SCOPES.INSTITUTION_ADMIN, adminUserId: user.adminUserId, institutionId: adminRow.institutionId });
    }
  }
  return NO_SCOPE;
}

/** Explicit constructors used by tests and by the roster/registration flows that act as the participant. */
const participantScope = (participantId) => (UUID.test(String(participantId || '')) ? make({ actorScope: SCOPES.PARTICIPANT, participantId }) : NO_SCOPE);
const institutionScope = (institutionId, adminUserId = null) => (typeof institutionId === 'string' && institutionId ? make({ actorScope: SCOPES.INSTITUTION_ADMIN, institutionId, adminUserId }) : NO_SCOPE);
const superAdminScope = (adminUserId) => make({ actorScope: SCOPES.SUPER_ADMIN, adminUserId: adminUserId || null });

/** True only for scopes created by this module (a plain object literal is never accepted). */
const isScope = (s) => !!s && s[SIGNED] === true;
const isPrivileged = (s) => isScope(s) && (s.actorScope === SCOPES.SUPER_ADMIN || s.actorScope === SCOPES.SYSTEM);

module.exports = { SCOPES, NO_SCOPE, buildScope, systemScope, participantScope, institutionScope, superAdminScope, isScope, isPrivileged };
