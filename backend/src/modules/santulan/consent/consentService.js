/*
 * Consent service (BUILD 04 section 10), on the store. Every step: authorise (done by the route) -> read -> require the legal
 * state -> compare-and-set write -> audit, in ONE transaction, and never touches attempts. Writes run under the SYSTEM scope
 * because participants have no direct write path to consents. Audit rows carry ids and states only: no OTP, contact detail,
 * name or verification evidence.
 */
const { HttpError } = require('../../../shared/errors');
const store = require('../store');
const identity = require('../store/repositories/identity');
const consents = require('../store/repositories/consents');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/consentRules');
const protocols = require('./protocolRegistry');
const { onWithdrawn } = require('./withdrawalHook');

const auditActor = (actor) => (actor.scope === 'PARTICIPANT'
  ? { actorType: 'PARTICIPANT', actorId: actor.participantId }
  : actor.scope === 'SUPER_ADMIN' ? { actorType: 'ADMIN', actorId: actor.adminUserId } : { actorType: 'SYSTEM', actorId: null });

const sanitize = (c) => ({
  consentId: c.consentId, consentType: c.consentType, giverRelationship: c.giverRelationship,
  protocolVersion: c.protocolVersion, status: c.status, grantedAt: c.grantedAt, verifiedAt: c.verifiedAt, withdrawnAt: c.withdrawnAt,
});

const asSystem = (fn) => store.withScope(store.systemScope(), fn, { transaction: true });

/** The participation gate for a participant, from stored age and consents. */
async function gateFor(tx, participantId) {
  const participant = await identity.getParticipant(tx, participantId);
  if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
  return rules.evaluateGate(participant, await consents.listForParticipant(tx, participantId));
}

/** Participant-facing reads run under the participant's own scope. */
async function getRequirements(participantId) {
  return store.withScope(store.participantScope(participantId), async (tx) => {
    const gate = await gateFor(tx, participantId);
    const list = await consents.listForParticipant(tx, participantId);
    return { isMinor: gate.isMinor, requiredTypes: gate.requiredTypes, consents: list.map(sanitize) };
  });
}

async function getGate(participantId) {
  return store.withScope(store.participantScope(participantId), async (tx) => {
    const { open, missingTypes } = await gateFor(tx, participantId);
    return { open, missingTypes };
  });
}

/** Loads a consent; a participant actor may only touch their own (someone else's looks like it does not exist). */
async function loadConsent(tx, consentId, actor) {
  const c = await consents.getConsent(tx, consentId);
  if (!c || (actor.scope === 'PARTICIPANT' && c.participantId !== actor.participantId)) throw new HttpError(404, 'NOT_FOUND', 'Consent not found');
  return c;
}

/** Applies a transition with compare-and-set; a concurrent winner makes this one fail with CONSENT_TRANSITION_INVALID. */
async function move(tx, c, to, patch) {
  rules.assertTransition(c.status, to);
  const updated = await consents.transitionConsent(tx, c.consentId, c.status, to, patch);
  if (!updated) throw rules.transitionError(c.status, to);
  return updated;
}

async function create({ participantId, consentType, giverRelationship, protocolVersion }, actor, correlationId) {
  if (giverRelationship === 'INSTITUTION_DELEGATED') throw new HttpError(422, 'VALIDATION_ERROR', 'INSTITUTION_DELEGATED is not permitted until an approved protocol authorises it');
  protocols.requireApproved(protocolVersion, consentType); // fail closed before any row exists
  return asSystem(async (tx) => {
    const participant = await identity.getParticipant(tx, participantId);
    if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
    rules.assertTypeForAge(consentType, participant.isMinor);
    rules.assertGiver(consentType, giverRelationship);
    const created = await consents.createConsent(tx, { participantId, consentType, giverRelationship, protocolVersion });
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_CREATED', targetEntity: 'consents', targetId: created.consentId, newState: { status: 'PENDING', consentType, protocolVersion }, correlationId });
    return sanitize(created);
  });
}

async function grant(consentId, actor, correlationId) {
  return asSystem(async (tx) => {
    const c = await loadConsent(tx, consentId, actor);
    if (actor.scope === 'PARTICIPANT' && c.giverRelationship !== 'SELF') throw new HttpError(403, 'FORBIDDEN', 'This consent is given by a parent or guardian');
    const updated = await move(tx, c, 'GRANTED');
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_GRANTED', targetEntity: 'consents', targetId: consentId, previousState: { status: 'PENDING' }, newState: { status: 'GRANTED' }, correlationId });
    return sanitize(updated);
  });
}

async function verify(consentId, verificationMethod, actor, correlationId) {
  return asSystem(async (tx) => {
    const c = await loadConsent(tx, consentId, actor);
    const protocol = protocols.requireApproved(c.protocolVersion, c.consentType);
    if (c.status !== 'GRANTED') throw rules.transitionError(c.status, 'VERIFIED');
    protocols.requireApprovedMethod(protocol, verificationMethod);
    const updated = await move(tx, c, 'VERIFIED', { verification_method: verificationMethod });
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_VERIFIED', targetEntity: 'consents', targetId: consentId, previousState: { status: 'GRANTED' }, newState: { status: 'VERIFIED', verificationMethod }, correlationId });
    return sanitize(updated);
  });
}

async function withdraw(consentId, actor, correlationId) {
  return asSystem(async (tx) => {
    const c = await loadConsent(tx, consentId, actor);
    if (c.status === 'WITHDRAWN') throw rules.transitionError('WITHDRAWN', 'WITHDRAWN');
    const updated = await move(tx, c, 'WITHDRAWN');
    await writeAudit(tx, { ...auditActor(actor), actionType: 'CONSENT_WITHDRAWN', targetEntity: 'consents', targetId: consentId, previousState: { status: c.status }, newState: { status: 'WITHDRAWN' }, correlationId });
    const gate = await gateFor(tx, c.participantId); // re-evaluated in the same transaction: closed immediately
    await onWithdrawn(tx, { participantId: c.participantId, consentId, correlationId });
    return { ...sanitize(updated), gateOpen: gate.open };
  });
}

module.exports = { getRequirements, getGate, create, grant, verify, withdraw, gateFor };
