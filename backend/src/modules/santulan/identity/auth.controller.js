/*
 * Authentication endpoints (contracts/api.md §2). OPEN participants authenticate by OTP; institutional participants and
 * admins by Santulan ID / login + password with a forced change of a temporary credential. A token is issued only after the
 * provider authenticates; the participant/admin is then resolved from the (provider, subject) pair stored canonically.
 */
const { z } = require('zod');
const { HttpError } = require('../../../shared/errors');
const { strictObject } = require('../shared/http');
const { withSystemTx, withCanonicalTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const { signToken, verifyPurposeToken } = require('../../../shared/middleware/auth');
const { SANTULAN_ID_PATTERN } = require('../registration/santulanId');
const { getProvider } = require('./index');

const channel = z.enum(['email', 'mobile']);
const requestOtpSchema = strictObject({ channel, identity: z.string().min(3).max(254) });
const verifyOtpSchema = strictObject({ channel, identity: z.string().min(3).max(254), code: z.string().regex(/^[0-9]{6}$/) });
const loginSchema = strictObject({ subject: z.string().min(1).max(128), password: z.string().min(1).max(200) });
const setPasswordSchema = strictObject({ newPassword: z.string().min(1).max(200) });

const sessionFor = (r) => (r.participantId
  ? signToken({ sub: r.participantId, role: 'participant', participantId: r.participantId })
  : signToken({ sub: r.adminUserId, role: 'admin', adminUserId: r.adminUserId }));

/** Resolves the canonical participant or active admin bound to a provider subject; null when none. */
async function resolveSubject(provider, subject) {
  return withSystemTx(async (tx) => {
    const p = (await tx.query(`SELECT participant_id, status FROM santulan.participants WHERE auth_provider = $1 AND auth_provider_subject_id = $2`, [provider, subject])).rows[0];
    if (p) return p.status === 'ACTIVE' ? { participantId: p.participantId } : null;
    const a = (await tx.query(`SELECT admin_user_id, status FROM santulan.admin_users WHERE auth_provider = $1 AND auth_provider_subject_id = $2`, [provider, subject])).rows[0];
    return a && a.status === 'ACTIVE' ? { adminUserId: a.adminUserId } : null;
  });
}

/** A user types their Santulan ID; the credential is stored under the provider subject bound to that participant. */
async function credentialSubject(provider, typed) {
  if (!SANTULAN_ID_PATTERN.test(typed)) return typed;
  const row = await withSystemTx(async (tx) => (await tx.query(
    'SELECT auth_provider_subject_id FROM santulan.participants WHERE santulan_id = $1 AND auth_provider = $2', [typed, provider.PROVIDER])).rows[0]);
  return row ? row.authProviderSubjectId : `unknown:${typed}`; // unknown ids still pay the same hashing cost
}

async function requestOtp(req, res, next) {
  try {
    const result = getProvider().requestOtp(req.body.channel, req.body.identity);
    if (result.rateLimited) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many codes requested. Please try again later.');
    res.status(202).json({ sent: true }); // never reveals whether the identity is already registered
  } catch (err) { next(err); }
}

async function verifyOtp(req, res, next) {
  try {
    const provider = getProvider();
    const { ok, subject } = provider.verifyOtp(req.body.channel, req.body.identity, req.body.code);
    if (!ok) throw new HttpError(401, 'UNAUTHENTICATED', 'That code did not match or has expired');
    const existing = await resolveSubject(provider.OTP_PROVIDER, subject);
    if (existing) return res.json({ registered: true, accessToken: sessionFor(existing) });
    const registrationToken = signToken({ sub: 'otp', purpose: 'age-declaration', authProvider: provider.OTP_PROVIDER, authProviderSubjectId: subject }, '30m');
    return res.json({ registered: false, registrationToken });
  } catch (err) { return next(err); }
}

async function login(req, res, next) {
  try {
    const provider = getProvider();
    const { password } = req.body;
    const typed = req.body.subject.trim();
    const subject = await credentialSubject(provider, /^stn-/i.test(typed) ? typed.toUpperCase() : typed);
    const auth = await provider.authenticate(subject, password);
    const who = auth.ok ? await resolveSubject(provider.PROVIDER, subject) : null;
    if (!auth.ok || !who) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid Santulan ID or password');
    if (auth.mustChange) {
      return res.json({ mustSetPassword: true, setPasswordToken: signToken({ sub: subject, purpose: 'set-password', subject }, '15m') });
    }
    return res.json({ accessToken: sessionFor(who) });
  } catch (err) { return next(err); }
}

async function setPassword(req, res, next) {
  try {
    const [, token] = (req.headers.authorization || '').split(' ');
    const { subject } = verifyPurposeToken(token || '', 'set-password');
    const provider = getProvider();
    const weak = provider.passwordProblem(req.body.newPassword);
    if (weak) throw new HttpError(400, 'VALIDATION_ERROR', `The new password needs ${weak}`);
    const result = await provider.setPassword(subject, req.body.newPassword);
    if (!result.ok) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid token');
    const who = await resolveSubject(provider.PROVIDER, subject);
    if (!who) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid token');
    res.json({ accessToken: sessionFor(who) });
  } catch (err) { next(err); }
}

/** Admin: issue a new temporary credential; the previous secret stops working at once (AT-27). Audited, never logs the secret. */
async function credentialReset(req, res, next) {
  try {
    const provider = getProvider();
    const p = await withCanonicalTx({ actorScope: 'SUPER_ADMIN', adminUserId: req.actor.adminUserId, asWorker: true }, async (tx) => {
      const { rows } = await tx.query('SELECT participant_id, santulan_id, auth_provider, auth_provider_subject_id FROM santulan.participants WHERE participant_id = $1', [req.params.id]);
      const row = rows[0];
      if (!row || row.authProvider !== provider.PROVIDER) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
      await writeAudit(tx, { actorType: 'ADMIN', actorId: req.actor.adminUserId, actionType: 'CREDENTIAL_RESET', targetEntity: 'participants', targetId: row.participantId, correlationId: req.correlationId });
      return row;
    });
    const temporaryPassword = await provider.issueTemporaryCredential(p.authProviderSubjectId);
    res.json({ santulanId: p.santulanId, temporaryPassword });
  } catch (err) { next(err); }
}

module.exports = { requestOtpSchema, verifyOtpSchema, loginSchema, setPasswordSchema, requestOtp, verifyOtp, login, setPassword, credentialReset };
