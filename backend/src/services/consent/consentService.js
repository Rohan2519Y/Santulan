/*
 * Consent service (BUILD 04 section 10), on the store. Every step: authorise (done by the route) -> read -> require the legal
 * state -> compare-and-set write -> audit, in ONE transaction, and never touches attempts. Writes run under the SYSTEM scope
 * because participants have no direct write path to consents. Audit rows carry ids and states only: no OTP, contact detail,
 * name or verification evidence.
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const identity = require('../../models/repositories/identity');
const consents = require('../../models/repositories/consents');
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

/** allowNonSelf: the one sanctioned exception (CR-006-14's minor self-service) that lets a PARTICIPANT actor grant a
 * PARENT_GUARDIAN_CONSENT record; the ordinary route never sets it, so a participant still cannot grant a parent's consent
 * through the general-purpose endpoint. */
async function grant(consentId, actor, correlationId, { allowNonSelf = false } = {}) {
  return asSystem(async (tx) => {
    const c = await loadConsent(tx, consentId, actor);
    if (actor.scope === 'PARTICIPANT' && c.giverRelationship !== 'SELF' && !allowNonSelf) throw new HttpError(403, 'FORBIDDEN', 'This consent is given by a parent or guardian');
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

const SELF_ATTEST_METHOD = 'SELF_ATTESTED';

/**
 * CR-006-13 (owner-approved 2026-09-22; a temporary stand-in until a real parent/guardian verification workflow is defined -
 * see specs/006-mongodb-question-upload/evidence/change-record-006.md): one self-service action, ADULTS ONLY. Creates the
 * participant's own ADULT_SELF_CONSENT record if it does not exist yet, then grants and verifies it - all three of the
 * ordinary admin-mediated steps, done here as one participant-initiated action instead. It reuses create/grant/verify
 * unchanged, so every existing rule (approved protocol required, SELF giver only, audit on each step) still applies; the
 * only new thing is who is allowed to trigger verify for this one consent type. A MINOR is refused outright: their consent
 * still needs the existing parent/guardian + assent flow, unchanged, with no self-service shortcut.
 */
async function selfConsent(participantId, actor, correlationId) {
  const participant = await store.withScope(store.participantScope(participantId), (tx) => identity.getParticipant(tx, participantId));
  if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
  if (participant.isMinor) {
    throw new HttpError(422, 'SELF_CONSENT_NOT_AVAILABLE', 'Self-consent is only available once you are 18 or older; you need parent/guardian consent and your own assent instead');
  }
  const protocolVersion = protocols.currentApprovedVersion('ADULT_SELF_CONSENT');
  const existing = (await store.withScope(store.participantScope(participantId), (tx) => consents.listForParticipant(tx, participantId)))
    .find((c) => c.consentType === 'ADULT_SELF_CONSENT' && c.status !== 'WITHDRAWN');
  let record = existing ? sanitize(existing) : await create({ participantId, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion }, actor, correlationId);
  if (record.status === 'PENDING') record = await grant(record.consentId, actor, correlationId);
  if (record.status === 'GRANTED') record = await verify(record.consentId, SELF_ATTEST_METHOD, actor, correlationId);
  return record; // already VERIFIED (or just became so): re-clicking the checkbox is a safe no-op, never an error
}

const PARENT_ATTEST_METHOD = 'STUDENT_ATTESTED_FOR_PARENT';

/** Creates (if missing), grants and verifies one consent record for `participantId`; idempotent (re-running on an already
 * VERIFIED record is a safe no-op). Shared by selfConsent-style actions. */
async function ensureVerified(participantId, consentType, giverRelationship, method, actor, correlationId) {
  const protocolVersion = protocols.currentApprovedVersion(consentType);
  const existing = (await store.withScope(store.participantScope(participantId), (tx) => consents.listForParticipant(tx, participantId)))
    .find((c) => c.consentType === consentType && c.status !== 'WITHDRAWN');
  let record = existing ? sanitize(existing) : await create({ participantId, consentType, giverRelationship, protocolVersion }, actor, correlationId);
  if (record.status === 'PENDING') record = await grant(record.consentId, actor, correlationId, { allowNonSelf: giverRelationship !== 'SELF' });
  if (record.status === 'GRANTED') record = await verify(record.consentId, method, actor, correlationId);
  return record;
}

/**
 * CR-006-14 (owner-approved 2026-09-22; a temporary stand-in until a real parent/guardian portal exists - see
 * specs/006-mongodb-question-upload/evidence/change-record-006.md): a MINOR confirms both required consents themselves, on
 * their own device, in one action. STUDENT_ASSENT is a genuine self-attestation (no safeguarding concern - it is the
 * student's own assent). PARENT_GUARDIAN_CONSENT is recorded too, but with a distinct verification method
 * (STUDENT_ATTESTED_FOR_PARENT) so its provenance is never confused with an actual parent/guardian action; the ordinary
 * admin-mediated path (a real parent verifying their own consent) is completely unchanged and still available. An adult is
 * refused: neither requirement applies to them.
 */
async function minorSelfService(participantId, actor, correlationId) {
  const participant = await store.withScope(store.participantScope(participantId), (tx) => identity.getParticipant(tx, participantId));
  if (!participant) throw new HttpError(404, 'NOT_FOUND', 'Participant not found');
  if (!participant.isMinor) {
    throw new HttpError(422, 'PARENT_CONSENT_NOT_APPLICABLE', 'This action is only for a minor participant; adults use self-consent instead');
  }
  const assent = await ensureVerified(participantId, 'STUDENT_ASSENT', 'SELF', SELF_ATTEST_METHOD, actor, correlationId);
  const parentGuardianConsent = await ensureVerified(participantId, 'PARENT_GUARDIAN_CONSENT', 'PARENT', PARENT_ATTEST_METHOD, actor, correlationId);
  return { assent, parentGuardianConsent };
}

module.exports = { getRequirements, getGate, create, grant, verify, withdraw, gateFor, selfConsent, minorSelfService };
