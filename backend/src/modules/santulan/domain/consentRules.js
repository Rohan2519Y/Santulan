/*
 * Consent rules (BUILD 04; data-model section 7). The consent machine PENDING -> GRANTED -> VERIFIED -> WITHDRAWN (WITHDRAWN
 * is terminal), type/giver/age compatibility from the participant's STORED age, and the participation gate. The store
 * validator holds the same-document parts (type/giver, VERIFIED fields, timestamps); moves and age checks live here and are
 * applied with compare-and-set in the repository.
 */
const { HttpError } = require('../../../shared/errors');

const REQUIRED_TYPES = {
  minor: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
  adult: ['ADULT_SELF_CONSENT'],
};

const TRANSITIONS = {
  PENDING: ['GRANTED', 'WITHDRAWN'],
  GRANTED: ['VERIFIED', 'WITHDRAWN'],
  VERIFIED: ['WITHDRAWN'],
  WITHDRAWN: [],
};

const PARENT_RELATIONSHIPS = new Set(['PARENT', 'GUARDIAN']);

const requiredTypes = (isMinor) => (isMinor ? REQUIRED_TYPES.minor : REQUIRED_TYPES.adult);

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const transitionError = (from, to) => new HttpError(409, 'CONSENT_TRANSITION_INVALID', `A consent in state ${from} cannot become ${to}`);

function assertTransition(from, to) {
  if (!canTransition(from, to)) throw transitionError(from, to);
}

/** A minor cannot hold ADULT_SELF_CONSENT; an adult cannot hold STUDENT_ASSENT or PARENT_GUARDIAN_CONSENT. */
function assertTypeForAge(consentType, isMinor) {
  if (!requiredTypes(isMinor).includes(consentType)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${consentType} is not required for this participant's age`);
  }
}

function assertGiver(consentType, giverRelationship) {
  if (giverRelationship === 'INSTITUTION_DELEGATED') {
    throw new HttpError(422, 'VALIDATION_ERROR', 'INSTITUTION_DELEGATED is not permitted until an approved protocol authorises it');
  }
  const ok = consentType === 'PARENT_GUARDIAN_CONSENT' ? PARENT_RELATIONSHIPS.has(giverRelationship) : giverRelationship === 'SELF';
  if (!ok) throw new HttpError(422, 'VALIDATION_ERROR', 'The giver relationship is not valid for this consent type');
}

/**
 * The participation gate: a minor needs VERIFIED PARENT_GUARDIAN_CONSENT and VERIFIED STUDENT_ASSENT; an adult needs VERIFIED
 * ADULT_SELF_CONSENT. GRANTED is not enough; a withdrawn consent never counts.
 */
function evaluateGate(participant, consents) {
  const required = requiredTypes(participant.isMinor);
  const verified = new Set(consents.filter((c) => c.status === 'VERIFIED' && !c.withdrawnAt).map((c) => c.consentType));
  const missing = required.filter((t) => !verified.has(t));
  return { isMinor: participant.isMinor, open: missing.length === 0, requiredTypes: required, missingTypes: missing };
}

module.exports = { REQUIRED_TYPES, TRANSITIONS, requiredTypes, canTransition, assertTransition, assertTypeForAge, assertGiver, evaluateGate, transitionError };
