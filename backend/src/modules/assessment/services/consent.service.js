const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');

async function recordConsent(participantProfileId, input) {
  const { consentType, protocolVersion, verificationMethod } = input;

  let status = 'GRANTED';
  let verifiedAt = null;
  if (consentType === 'PARENT_GUARDIAN_CONSENT') {
    if (verificationMethod) {
      status = 'VERIFIED';
      verifiedAt = new Date();
    } else {
      status = 'PENDING';
    }
  }

  const { rows } = await db.query(
    `INSERT INTO consents (id, participant_profile_id, consent_type, protocol_version, verification_method, verified_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [randomUUID(), participantProfileId, consentType, protocolVersion, verificationMethod || null, verifiedAt, status]
  );
  return rows[0];
}

/**
 * FR-012 gate: a minor cannot reach an active attempt without VERIFIED
 * PARENT_GUARDIAN_CONSENT AND a separately recorded STUDENT_ASSENT; an adult
 * needs a GRANTED (or VERIFIED) ADULT_SELF_CONSENT.
 */
async function assertConsentGate(participantProfile) {
  const { rows: consents } = await db.query('SELECT * FROM consents WHERE participant_profile_id = $1', [participantProfile.id]);
  const latestByType = {};
  for (const consent of consents) {
    const existing = latestByType[consent.consentType];
    if (!existing || consent.createdAt > existing.createdAt) latestByType[consent.consentType] = consent;
  }

  const missing = [];

  if (participantProfile.isMinor) {
    const parentConsent = latestByType.PARENT_GUARDIAN_CONSENT;
    if (!parentConsent || parentConsent.status !== 'VERIFIED') missing.push('PARENT_GUARDIAN_CONSENT (verified)');

    const assent = latestByType.STUDENT_ASSENT;
    if (!assent || !['GRANTED', 'VERIFIED'].includes(assent.status)) missing.push('STUDENT_ASSENT');
  } else {
    const selfConsent = latestByType.ADULT_SELF_CONSENT;
    if (!selfConsent || !['GRANTED', 'VERIFIED'].includes(selfConsent.status)) missing.push('ADULT_SELF_CONSENT');
  }

  if (missing.length > 0) {
    throw new HttpError(403, 'CONSENT_INCOMPLETE', 'Consent/assent gate not met', { requiredConsents: missing });
  }
}

module.exports = { recordConsent, assertConsentGate };
