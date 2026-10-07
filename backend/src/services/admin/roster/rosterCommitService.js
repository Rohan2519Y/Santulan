/*
 * Roster commit service (spec 005 T075 / US4). After a CLEAN validate, registers one INSTITUTIONAL participant per row
 * in a single transaction (all-or-nothing): participant, identification, credential and audit rows either all persist
 * or none do.
 * The dev identity provider's temporary credentials are inserted inside the same transaction, so a failure anywhere
 * rolls back the whole import. Plaintext passwords exist only in the in-memory export store (credentialExport.js).
 *
 * The participant's provider subject is deterministic per (institution, Reg. Number), so re-importing the same pupil in
 * the same institution is refused up front (ALREADY_IMPORTED) instead of creating a second account.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('../../../errors');
const config = require('../../../config');
const { getProvider } = require('../../identity');
const store = require('../../../models/db');
const identity = require('../../../models/repositories/identity');
const devIdentity = require('../../../models/repositories/devIdentity');
const { writeAudit } = require('../../audit/auditService');
const rules = require('../../domain/registrationRules');
const { buildPilotDetails } = require('../../domain/participantPilotDetailsRules');
const { validate: validateRows } = require('./rosterValidator');
const { store: storeCredentials } = require('./credentialExport');

// G-38: the login subject is a keyed hash (HMAC with a server-side key), not a plain hash of two values an outsider can know - the school's
// id and a registration number. It stays deterministic per (institution, Reg. Number) so a repeat import is still recognised, but it cannot
// be computed without the key. Subjects created before this change are stored on the participant and keep working.
const subjectFor = (institutionId, externalStudentId) => crypto.createHmac('sha256', config.subjectKey).update(`institutional:${institutionId}:${externalStudentId}`).digest('hex');
const MAX_ATTEMPTS = 5;

const isSantulanIdCollision = (err) => err && err.code === 'DUPLICATE_IDENTITY' && err.cause && /santulan_id/.test(err.cause.message || '');

/**
 * @param {object} input  rows (raw parser rows), institutionId, cohortId, adminUserId, correlationId
 * @returns {{importId, count, eligible, rows: [{participantId, santulanId, temporaryPassword}]}}
 */
async function commitRoster({ rows, institutionId, cohortId, adminUserId, correlationId = null }) {
  const check = validateRows(rows);
  if (!check.ok) throw new HttpError(422, 'VALIDATION_ERROR', 'Roster validation failed; nothing was imported', { errors: check.errors });

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    throw new HttpError(503, 'ROSTER_UNAVAILABLE', 'No credential provider is available to issue temporary credentials');
  }
  const usesDevCredentialStore = provider.PROVIDER === 'santulan-dev';

  // Temporary passwords and their bcrypt hashes are prepared BEFORE the transaction (hashing is slow; a transaction must stay short).
  const prepared = await Promise.all(check.rows.map(async (row) => {
    const temporaryPassword = `${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 11)}7`;
    return { row, subject: subjectFor(institutionId, row.externalStudentId), temporaryPassword, hash: usesDevCredentialStore ? await bcrypt.hash(temporaryPassword, 10) : null };
  }));

  const provisioned = [];
  if (!usesDevCredentialStore) {
    try {
      for (const entry of prepared) {
        await provider.provisionTemporaryCredential(entry.subject, entry.temporaryPassword);
        provisioned.push(entry.subject);
      }
    } catch (err) {
      await Promise.allSettled(provisioned.map((subject) => provider.revoke(subject)));
      throw new HttpError(503, 'ROSTER_UNAVAILABLE', 'The credential provider could not create roster credentials');
    }
  }

  const once = () => store.withScope(store.systemScope(), async (tx) => {
    const scope = await identity.findActiveScope(tx, institutionId, cohortId);
    if (!scope) throw new HttpError(422, 'SCOPE_INVALID', 'The institution or cohort is not available');

    const committed = [];
    for (const { row, subject, temporaryPassword, hash } of prepared) {
      // Recognised by subject (this import scheme) or by the registration number in the same institution (rosters imported before the
      // subject became keyed), so changing the scheme can never create a second account for the same pupil.
      const prior = await identity.findParticipantByAuthSubject(tx, provider.PROVIDER, subject)
        || await tx.c.participants.findOne({ institution_id: institutionId, external_student_id: row.externalStudentId });
      if (prior) throw new HttpError(422, 'ALREADY_IMPORTED', `Reg. Number ${row.externalStudentId} is already importable from a previous roster`, { reg: row.externalStudentId });

      const doc = rules.buildParticipant({
        _id: uuidv4(), route: 'INSTITUTIONAL', age: row.age, institutionId, cohortId, externalStudentId: row.externalStudentId,
        authProvider: provider.PROVIDER, authProviderSubjectId: subject,
      });
      const participant = await identity.insertParticipant(tx, doc);
      await identity.insertPilotDetails(tx, buildPilotDetails({
        _id: uuidv4(),
        participantId: participant.participantId,
        body: {
          fullName: row.fullName,
          dateOfBirth: row.dateOfBirth,
          className: row.className,
          gender: row.gender,
        },
      }));
      if (usesDevCredentialStore) await devIdentity.upsertTemporary(tx, provider.PROVIDER, subject, hash);

      const track = participant.assessmentTrack;
      await writeAudit(tx, {
        actorType: 'ADMIN', actorId: adminUserId, actionType: 'ROSTER_IMPORTED', targetEntity: 'participants',
        targetId: participant.participantId, newState: { track, external_student_id: row.externalStudentId }, correlationId,
      });
      await writeAudit(tx, {
        actorType: 'ADMIN', actorId: adminUserId, actionType: 'CREDENTIAL_ISSUED', targetEntity: 'participants',
        targetId: participant.participantId, newState: { track, must_change: true }, correlationId,
      });

      committed.push({
        participantId: participant.participantId, santulanId: participant.santulanId, temporaryPassword,
        fullName: row.fullName, dateOfBirth: row.dateOfBirth, gender: row.gender, age: row.age, className: row.className,
        section: row.section, externalStudentId: row.externalStudentId,
      });
    }
    return committed;
  }, { transaction: true });

  let result = null;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt += 1) {
      try {
        result = await once();
      } catch (err) {
        if (!isSantulanIdCollision(err) || attempt === MAX_ATTEMPTS) throw err; // only an ID collision retries the whole import
      }
    }
  } catch (err) {
    if (!usesDevCredentialStore) await Promise.allSettled(provisioned.map((subject) => provider.revoke(subject)));
    throw err;
  }

  const importId = storeCredentials(result.map(({ participantId: _pid, ...rest }) => rest));
  return {
    importId,
    count: result.length,
    eligible: check.eligible,
    rows: result.map(({ participantId, santulanId, temporaryPassword }) => ({ participantId, santulanId, temporaryPassword })),
  };
}

module.exports = { commitRoster, subjectFor };
