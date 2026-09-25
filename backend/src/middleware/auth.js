/*
 * Authentication for the canonical API (contracts/api.md §1).
 *  - Bearer JWT claims: sub, role ('participant' | 'admin'), participantId / adminUserId. Participant identity is ALWAYS
 *    taken from the token, never from a body or path field.
 *  - Purpose-scoped tokens (e.g. set-password) are never accepted as sessions.
 *  - requireParticipantToken / requireActiveSuperAdmin re-check the database on every request, so a suspended participant
 *    or admin loses access immediately (BUILD 08 B08-008).
 *  - requireInternal guards worker / verifier endpoints with a shared key (never a browser token).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('../errors');

const signToken = (claims, expiresIn = config.jwtExpiresIn) => jwt.sign(claims, config.jwtSecret, { expiresIn });

function readBearer(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing or invalid Authorization header');
  return token;
}

function verify(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }
}

/** Verifies a purpose-scoped token (e.g. 'set-password'); returns its claims. */
function verifyPurposeToken(token, purpose) {
  const payload = verify(token);
  if (payload.purpose !== purpose) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid token');
  return payload;
}

function authenticate(req, res, next) {
  try {
    const payload = verify(readBearer(req));
    if (payload.purpose) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid token');
    req.user = {
      id: payload.sub,
      role: payload.role,
      participantId: payload.participantId || null,
      adminUserId: payload.adminUserId || null,
      pv: payload.pv || null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// The store is loaded lazily so tests that only exercise token helpers never need a database connection.
const sessionCheck = () => require('../services/identity/sessionCheck'); // eslint-disable-line global-require

function requireParticipantToken(req, res, next) {
  authenticate(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (req.user.role !== 'participant' || !req.user.participantId) throw new HttpError(403, 'FORBIDDEN', 'Participant access required');
      const row = await sessionCheck().participantSession(req.user.participantId);
      if (!row || row.status !== 'ACTIVE') throw new HttpError(403, 'FORBIDDEN', 'Participant is not active');
      // Credential-version revocation (SEC-29 / T072): a token minted before a password reset or suspension is dead.
      if (req.user.pv && sessionCheck().currentVersion(row) !== req.user.pv) throw new HttpError(403, 'FORBIDDEN', 'Session revoked. Please sign in again.');
      req.actor = { scope: 'PARTICIPANT', participantId: req.user.participantId };
      return next();
    } catch (e) {
      return next(e);
    }
  });
}

function requireActiveSuperAdmin(req, res, next) {
  authenticate(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (req.user.role !== 'admin' || !req.user.adminUserId) throw new HttpError(403, 'FORBIDDEN', 'Administrator access required');
      const row = await sessionCheck().adminSession(req.user.adminUserId);
      if (!row || row.status !== 'ACTIVE' || row.role !== 'SUPER_ADMIN') throw new HttpError(403, 'FORBIDDEN', 'An active SUPER_ADMIN is required');
      req.actor = { scope: 'SUPER_ADMIN', adminUserId: req.user.adminUserId };
      return next();
    } catch (e) {
      return next(e);
    }
  });
}

function requireInternal(req, res, next) {
  const expected = Buffer.from(config.internalApiKey || '');
  const given = Buffer.from(String(req.headers['x-internal-api-key'] || ''));
  const ok = expected.length > 0 && expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!ok) return next(new HttpError(403, 'FORBIDDEN', 'Internal access only'));
  req.actor = { scope: 'SYSTEM' };
  return next();
}

/** Privileged callers only: the shared internal key (services / verifier callbacks) or an active SUPER_ADMIN token. */
function requireInternalOrSuperAdmin(req, res, next) {
  if (req.headers['x-internal-api-key']) return requireInternal(req, res, next);
  return requireActiveSuperAdmin(req, res, next);
}

/** The participant themself (token) or a privileged caller; the service narrows what each actor may touch. */
function requireParticipantOrPrivileged(req, res, next) {
  if (req.headers['x-internal-api-key']) return requireInternal(req, res, next);
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return req.user.role === 'admin' ? requireActiveSuperAdmin(req, res, next) : requireParticipantToken(req, res, next);
  });
}

module.exports = { requireInternalOrSuperAdmin, requireParticipantOrPrivileged, signToken, verifyPurposeToken, authenticate, requireParticipantToken, requireActiveSuperAdmin, requireInternal };
