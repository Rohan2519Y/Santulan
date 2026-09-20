/*
 * Consent service (BUILD 04 §10). Every step: authorise (done by the route) -> lock the row -> require the legal state ->
 * write -> audit, in ONE transaction, and never touches attempts. Writes run as the controlled worker role because
 * participants have no direct write path to consents (RLS). Audit rows carry ids and states only: no OTP, contact
 * detail, name or verification evidence.
 */
const { HttpError } = require('../../../shared/errors');
const { withCanonicalTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const protocols = require('./protocolRegistry');
const { onWithdrawn } = require('./withdrawalHook');

const PARENT_RELATIONSHIPS = new Set(['PARENT', 'GUARDIAN']);
const auditActor = (actor) => (actor.scope === 'PARTICIPANT'
  ? { actorType: 'PARTICIPANT', actorId: actor.participantId }
  : actor.scope === 'SUPER_ADMIN' ? { actorType: 'ADMIN', actorId: actor.adminUserId } : { actorType: 'SYSTEM', actorId: null });
const sanitize = (c) => ({
  consentId: c.consentId, consentType: c.consentType, giverRelationship: c.giverRelationship,
  protocolVersion: c.protocolVersion, status: c.status, grantedAt: c.grantedAt, verifiedAt: c.verifiedAt, withdrawnAt: c.withdrawnAt,
});

async function gateFor(tx, participantId) {
  const { rows } = await tx.query('SELECT * FROM santulan.build04_consent_gate($1)', [participantId]);
  const g = rows[0];
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
  return { isMinor: g.isMinor, open: g.gateOpen, requiredTypes: g.requiredTypes, missingTypes: g.missingTypes };
}

/** Participant-facing reads run under the participant's own RLS context. */
async function getRequirements(participantId) {
  return withCanonicalTx({ actorScope: 'PARTICIPANT', participantId }, async (tx) => {
    const gate = await gateFor(tx, participantId);
    const { rows } = await tx.query('SELECT * FROM santulan.consents WHERE participant_id = $1 ORDER BY created_at', [participantId]);
    return { isMinor: gate.isMinor, requiredTypes: gate.requiredTypes, consents: rows.map(sanitize) };
  });
}

async function getGate(participantId) {
  return withCanonicalTx({ actorScope: 'PARTICIPANT', participantId }, async (tx) => {
    const { open, missingTypes } = await gateFor(tx, participantId);
    return { open, missingTypes };
  });
}

/** Loads and locks a consent inside a SYSTEM transaction; a participant actor may only touch their own. */
async function lockConsent(tx, consentId, actor) {
  const { rows } = await tx.query('SELECT * FROM santulan.consents WHERE consent_id = $1 FOR UPDATE', [consentId]);
  const c = rows[0];
  if (!c || (actor.scope === 'PARTICIPANT' && c.participantId !== actor.participantId)) throw new HttpError(404, 'NOT_FOUND', 'Consent not found');
  return c;
}

const transition = (from, to) => new HttpError(409, 'CONSENT_TRANSITION_INVALID', `A consent in state ${from} cannot become ${to}`);

async function create({ participantId, consentType, giverRelationship, protocolVersion }, actor, correlationId) {
  if (giverRelationship === 'INSTITUTION_DELEGATED') throw new HttpError(422, 'VALIDATION_ERROR', 'INSTITUTION_DELEGATED is not permitted until an approved protocol authorises it');
  protocols.requireApproved(protocolVersion, consentType);   // fail closed before any row exists
  return withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, async (tx) => {
    const gate = await gateFor(tx, participantId);
    if (!gate.requiredTypes.includes(consentType)) throw new HttpError(422, 'VALIDATION_ERROR', `${consentType} is not required for this participant's age`);
    if (consentType === 'PARENT_GUARDIAN_CONSENT' ? !PARENT_RELATIONSHIPS.has(giverRelationship) : giverRelationship !== 'SELF') {
      throw new HttpError(422, 'VALIDATION_ERROR', 'The giver relationship is not valid for this consent type');
    }
    const { rows } = await tx.query(
      `INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1, $2, $3, $4) RETURNING *`,
      [participantId, consentType, giverRelationship, protocolVersion],
    );
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_CREATED', targetEntity: 'consents', targetId: rows[0].consentId, newState: { status: 'PENDING', consentType, protocolVersion }, correlationId });
    return sanitize(rows[0]);
  });
}

async function grant(consentId, actor, correlationId) {
  return withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, async (tx) => {
    const c = await lockConsent(tx, consentId, actor);
    if (actor.scope === 'PARTICIPANT' && c.giverRelationship !== 'SELF') throw new HttpError(403, 'FORBIDDEN', 'This consent is given by a parent or guardian');
    if (c.status !== 'PENDING') throw transition(c.status, 'GRANTED');
    const { rows } = await tx.query(`UPDATE santulan.consents SET status = 'GRANTED', granted_at = now() WHERE consent_id = $1 RETURNING *`, [consentId]);
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_GRANTED', targetEntity: 'consents', targetId: consentId, previousState: { status: 'PENDING' }, newState: { status: 'GRANTED' }, correlationId });
    return sanitize(rows[0]);
  });
}

async function verify(consentId, verificationMethod, actor, correlationId) {
  return withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, async (tx) => {
    const c = await lockConsent(tx, consentId, actor);
    const protocol = protocols.requireApproved(c.protocolVersion, c.consentType);
    if (c.status !== 'GRANTED') throw transition(c.status, 'VERIFIED');
    protocols.requireApprovedMethod(protocol, verificationMethod);
    const { rows } = await tx.query(
      `UPDATE santulan.consents SET status = 'VERIFIED', verified_at = now(), verification_method = $2 WHERE consent_id = $1 RETURNING *`,
      [consentId, verificationMethod],
    );
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_VERIFIED', targetEntity: 'consents', targetId: consentId, previousState: { status: 'GRANTED' }, newState: { status: 'VERIFIED', verificationMethod }, correlationId });
    return sanitize(rows[0]);
  });
}

async function withdraw(consentId, actor, correlationId) {
  return withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, async (tx) => {
    const c = await lockConsent(tx, consentId, actor);
    if (c.status === 'WITHDRAWN') throw transition('WITHDRAWN', 'WITHDRAWN');
    const { rows } = await tx.query(`UPDATE santulan.consents SET status = 'WITHDRAWN', withdrawn_at = now() WHERE consent_id = $1 RETURNING *`, [consentId]);
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_WITHDRAWN', targetEntity: 'consents', targetId: consentId, previousState: { status: c.status }, newState: { status: 'WITHDRAWN' }, correlationId });
    const gate = await gateFor(tx, c.participantId);   // re-evaluated in the same transaction: closed immediately
    await onWithdrawn(tx, { participantId: c.participantId, consentId, correlationId });
    return { ...sanitize(rows[0]), gateOpen: gate.open };
  });
}

module.exports = { getRequirements, getGate, create, grant, verify, withdraw };
