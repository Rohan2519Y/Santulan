/*
 * Roster commit service (spec 005 T075 / US4). After a CLEAN validate, registers one INSTITUTIONAL participant per row
 * in a single transaction (all-or-nothing): participant row + dev credential + audit rows either all persist or none do.
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
const { getProvider } = require('../../identity');
const store = require('../../../models/db');
const identity = require('../../../models/repositories/identity');
const devIdentity = require('../../../models/repositories/devIdentity');
const { writeAudit } = require('../../audit/auditService');
const rules = require('../../domain/registrationRules');
const { validate: validateRows } = require('./rosterValidator');
const { store: storeCredentials } = require('./credentialExport');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const subjectFor = (institutionId, externalStudentId) => sha256(`institutional:${institutionId}:${externalStudentId}`);
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

  // Temporary passwords and their bcrypt hashes are prepared BEFORE the transaction (hashing is slow; a transaction must stay short).
  const prepared = await Promise.all(check.rows.map(async (row) => {
    const temporaryPassword = `${crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 11)}7`;
    return { row, subject: subjectFor(institutionId, row.externalStudentId), temporaryPassword, hash: await bcrypt.hash(temporaryPassword, 10) };
  }));

  const once = () => store.withScope(store.systemScope(), async (tx) => {
    const scope = await identity.findActiveScope(tx, institutionId, cohortId);
    if (!scope) throw new HttpError(422, 'SCOPE_INVALID', 'The institution or cohort is not available');

    const committed = [];
    for (const { row, subject, temporaryPassword, hash } of prepared) {
      const prior = await identity.findParticipantByAuthSubject(tx, provider.PROVIDER, subject);
      if (prior) throw new HttpError(422, 'ALREADY_IMPORTED', `Reg. Number ${row.externalStudentId} is already importable from a previous roster`, { reg: row.externalStudentId });

      const doc = rules.buildParticipant({
        _id: uuidv4(), route: 'INSTITUTIONAL', age: row.age, institutionId, cohortId, externalStudentId: row.externalStudentId,
        authProvider: provider.PROVIDER, authProviderSubjectId: subject,
      });
      const participant = await identity.insertParticipant(tx, doc);
      await devIdentity.upsertTemporary(tx, provider.PROVIDER, subject, hash);

      const track = participant.assessmentTrack;
      await writeAudit(tx, {
        actorType: 'ADMIN', actorId: adminUserId, actionType: 'ROSTER_IMPORTED', targetEntity: 'participants',
        targetId: participant.participantId, newState: { track, external_student_id: row.externalStudentId }, correlationId,
      });
      await writeAudit(tx, {
        actorType: 'ADMIN', actorId: adminUserId, actionType: 'CREDENTIAL_ISSUED', targetEntity: 'participants',
        targetId: participant.participantId, newState: { track, must_change: true }, correlationId,
      });

      committed.push({ participantId: participant.participantId, santulanId: participant.santulanId, temporaryPassword });
    }
    return committed;
  }, { transaction: true });

  let result = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt += 1) {
    try {
      result = await once();
    } catch (err) {
      if (!isSantulanIdCollision(err) || attempt === MAX_ATTEMPTS) throw err; // only an ID collision retries the whole import
    }
  }

  const importId = storeCredentials(result.map(({ santulanId, temporaryPassword }) => ({ santulanId, temporaryPassword })));
  return {
    importId,
    count: result.length,
    eligible: check.eligible,
    rows: result.map(({ participantId, santulanId, temporaryPassword }) => ({ participantId, santulanId, temporaryPassword })),
  };
}

module.exports = { commitRoster, subjectFor };