/*
 * Research export service (BUILD 08 section 10; feature 006 US5).
 *
 *   request   POST /research-exports  (Idempotency-Key): validates the anonymisation version, the source set and the filters, then stores
 *             the request (requester, filters, anonymisation version, source set, REQUESTED) and its audit row in ONE transaction. The
 *             outcome is recorded under a deterministic audit id, so a repeated key returns the same export and two racing requests cannot
 *             both create one.
 *   generate  the worker's step: claim REQUESTED -> GENERATING (compare-and-set: two workers claim once), stream the workbook to a partial
 *             file, move it into protected storage (EXPORT_DIR), then READY. Any failure deletes the file and records FAILED - there is
 *             never a downloadable partial file.
 *   download  only for a READY export; the download audit row is written FIRST in its own transaction and a failure to audit refuses the
 *             download (fails closed). No file path ever leaves the server.
 */
const fs = require('fs');
const path = require('path');
const { HttpError } = require('../../../shared/errors');
const config = require('../../../config');
const store = require('../store');
const exportsRepo = require('../store/repositories/exports');
const { writeAudit } = require('../audit/auditService');
const { payloadHash, keyToken, outcomeId, findOutcome, isRace } = require('../shared/idempotency');
const rules = require('../domain/exportRules');
const { writeWorkbook } = require('./workbookWriter');
const identity = require('./researchIdentity');

const ACTION_REQUESTED = 'RESEARCH_EXPORT_REQUESTED';
const MAX_ATTEMPTS = 6;
const sa = (actor) => store.superAdminScope(actor.adminUserId);
const sys = () => store.systemScope();

const exportDir = () => path.resolve(config.exportDir || path.join(__dirname, '..', '..', '..', '..', 'exports'));
const finalPath = (exportId) => path.join(exportDir(), `${exportId}.xlsx`);
const partPath = (exportId) => path.join(exportDir(), `${exportId}.xlsx.part`);

const shape = (x) => ({
  exportId: x.exportId, status: x.status, createdAt: x.createdAt, completedAt: x.completedAt || null, filters: x.filters, anonymisationVersion: x.anonymisationVersion,
  sourceAssessmentVersionId: x.sourceAssessmentVersionId, dataset: rules.datasetOf(x.filters),
});

// ---------------------------------------------------------------------------------------------------------------- request
async function request(actor, { idempotencyKey, body, correlationId }) {
  const filters = rules.normaliseRequest(body);
  const anonymisationVersion = String(body.anonymisationVersion || '').trim();
  if (!anonymisationVersion) throw new HttpError(422, 'VALIDATION_ERROR', 'An anonymisation version is required');
  const hash = payloadHash({ sourceAssessmentVersionId: body.sourceAssessmentVersionId, anonymisationVersion, filters });

  const once = () => store.withScope(sa(actor), async (tx) => {
    const prior = await findOutcome(tx, ACTION_REQUESTED, idempotencyKey);
    if (prior) {
      if (prior.newState.payload_hash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used with a different request');
      return { replay: true, export: await exportsRepo.getExport(tx, prior.targetId) };
    }
    const set = await tx.c.assessment_versions.findOne({ _id: body.sourceAssessmentVersionId });
    if (!set) throw new HttpError(422, 'VALIDATION_ERROR', 'The source question set does not exist');
    if (filters.institutionId && !(await tx.c.institutions.exists(filters.institutionId))) throw new HttpError(422, 'SCOPE_INVALID', 'The institution filter does not exist');
    if (filters.cohortId && !(await tx.c.cohorts.exists(filters.cohortId))) throw new HttpError(422, 'SCOPE_INVALID', 'The cohort filter does not exist');
    const created = await exportsRepo.insertExport(tx, { requestedBy: actor.adminUserId, filters, anonymisationVersion, sourceAssessmentVersionId: set._id });
    await writeAudit(tx, {
      id: outcomeId(ACTION_REQUESTED, idempotencyKey), actorType: 'ADMIN', actorId: actor.adminUserId, actionType: ACTION_REQUESTED, targetEntity: 'research_exports', targetId: created.exportId,
      newState: { payload_hash: hash, status: 'REQUESTED', dataset: rules.datasetOf(filters) }, correlationId: keyToken(idempotencyKey),
    });
    return { replay: false, export: created };
  }, { transaction: true });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try { const r = await once(); return { replay: r.replay, ...shape(r.export) }; } catch (err) {
      if (isRace(err) && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error('export request did not converge');
}

async function getStatus(actor, exportId) {
  return store.withScope(sa(actor), async (tx) => {
    const x = await exportsRepo.getExport(tx, exportId);
    if (!x) throw new HttpError(404, 'NOT_FOUND', 'Export not found');
    return shape(x);
  });
}

async function list(actor) {
  return store.withScope(sa(actor), async (tx) => ({ exports: (await exportsRepo.listRecent(tx)).map(shape) }));
}

// ---------------------------------------------------------------------------------------------------------------- download
async function prepareDownload(actor, exportId, correlationId) {
  const x = await store.withScope(sa(actor), async (tx) => {
    const row = await exportsRepo.getExport(tx, exportId);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Export not found');
    if (row.status !== 'READY') throw new HttpError(422, 'INVALID_STATE', `The export is not ready (${row.status})`);
    // the audit row is the precondition of the download: if it cannot be written the transaction fails and nothing is streamed
    await writeAudit(tx, { actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'RESEARCH_EXPORT_DOWNLOADED', targetEntity: 'research_exports', targetId: exportId, correlationId });
    return row;
  }, { transaction: true });
  const file = finalPath(x.exportId);
  if (path.basename(x.fileReference) !== x.fileReference || x.fileReference !== `${x.exportId}.xlsx` || !fs.existsSync(file)) throw new HttpError(404, 'NOT_FOUND', 'The export file is no longer available');
  return { file, size: fs.statSync(file).size, name: `santulan_research_export_${x.createdAt.toISOString().slice(0, 10)}.xlsx` };
}

// ---------------------------------------------------------------------------------------------------------------- generate
/** The people and attempts the export covers: attempts of the source set for participants matching the filters. */
async function buildScope(tx, x) {
  const f = x.filters;
  const person = {};
  if (f.institutionId) person.institution_id = f.institutionId;
  if (f.cohortId) person.cohort_id = f.cohortId;
  if (f.participantStatus) person.status = f.participantStatus;
  const attemptFilter = { assessment_version_id: x.sourceAssessmentVersionId };
  if (f.dateFrom || f.dateTo) {
    attemptFilter.created_at = {};
    if (f.dateFrom) attemptFilter.created_at.$gte = new Date(`${f.dateFrom}T00:00:00.000Z`);
    if (f.dateTo) attemptFilter.created_at.$lt = new Date(Date.parse(`${f.dateTo}T00:00:00.000Z`) + 24 * 3600 * 1000);
  }
  const attempts = await tx.c.assessment_attempts.find(attemptFilter, { projection: { _id: 1, participant_id: 1 } });
  const people = await tx.c.participants.find({ ...person, _id: { $in: [...new Set(attempts.map((a) => a.participant_id))] } }, { projection: { _id: 1, santulan_id: 1 } });
  const allowed = new Set(people.map((p) => p._id));
  const set = await tx.c.assessment_versions.findOne({ _id: x.sourceAssessmentVersionId });
  const cohortFilter = {};
  if (f.institutionId) cohortFilter.institution_id = f.institutionId;
  if (f.cohortId) cohortFilter.cohort_id = f.cohortId;
  return {
    attemptIds: attempts.filter((a) => allowed.has(a.participant_id)).map((a) => a._id),
    santulanIds: people.map((p) => p.santulan_id),
    sourceSet: set,
    cohortFilter,
  };
}

function describeFilters(filters) {
  const shown = Object.entries(filters).filter(([k, v]) => k !== 'includeAllVersions' && v !== undefined && v !== null && v !== '');
  return shown.length ? shown.map(([k, v]) => `${k}=${v}`).join('; ') : 'none (all participants of the source question set)';
}

/** Generates one export the caller has already claimed. Returns { sheets, excluded }. Throws (and leaves no file) on failure. */
async function generateFile(x, { onProgress } = {}) {
  fs.mkdirSync(exportDir(), { recursive: true });
  const part = partPath(x.exportId);
  const policy = identity.getPolicy();
  try {
    const result = await store.withScope(sys(), async (tx) => {
      const scope = await buildScope(tx, x);
      const dataset = rules.datasetOf(x.filters);
      const meta = {
        readme: [
          'This file is a research export from the Santulan platform.',
          `Dataset: ${dataset} (${dataset === 'all-versions' ? 'every saved version of each answer' : 'the current answer for each question only'})`,
          `Anonymisation version: ${x.anonymisationVersion}`,
          'Participants appear only by their opaque Santulan ID. No name, contact detail, guardian detail, login identifier or date of birth is included.',
          'Participants who withdrew are excluded; their number is stated in EXPORT_METADATA.',
          'Domain results are research data, not participant feedback. Interpret them only with the approved scoring documentation.',
          'See DATA_DICTIONARY for every column.',
        ],
        metadata: (written, excluded) => [
          ['export_id', x.exportId], ['generated_at', new Date().toISOString()], ['dataset', dataset], ['anonymisation_version', x.anonymisationVersion],
          ['identity_policy', `${policy.name} v${policy.version}`], ['source_question_set', `${scope.sourceSet.version_label} r${scope.sourceSet.revision}`],
          ['source_question_set_id', scope.sourceSet._id], ['source_content_hash', scope.sourceSet.content_hash], ['filters_applied', describeFilters(x.filters)],
          ['include_all_versions', String(x.filters.includeAllVersions === true)], ['withdrawn_participants_excluded', String(excluded.withdrawn)],
          ...written.map((w) => [`rows_${w.name}`, String(w.rows)]),
        ],
      };
      return writeWorkbook(part, { tx, scope, meta, policy, includeAllVersions: x.filters.includeAllVersions === true, onProgress });
    });
    fs.renameSync(part, finalPath(x.exportId)); // "protected storage": a different name, only ever a READY export
    return result;
  } catch (err) {
    fs.rmSync(part, { force: true });
    fs.rmSync(finalPath(x.exportId), { force: true });
    throw err;
  }
}

/** Claims and generates one REQUESTED export (the worker's unit of work). Returns the final state or null when another worker won the claim. */
async function claimAndGenerate(exportId, { correlationId, onProgress } = {}) {
  const claimed = await store.withScope(sys(), async (tx) => {
    if (!(await exportsRepo.claim(tx, exportId))) return null;
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'RESEARCH_EXPORT_STARTED', targetEntity: 'research_exports', targetId: exportId, newState: { status: 'GENERATING' }, correlationId });
    return exportsRepo.getExport(tx, exportId);
  }, { transaction: true });
  if (!claimed) return null;

  try {
    const result = await generateFile(claimed, { onProgress });
    await store.withScope(sys(), async (tx) => {
      if (!(await exportsRepo.markReady(tx, exportId, `${exportId}.xlsx`))) throw new HttpError(409, 'INVALID_STATE', 'The export changed while completing');
      await writeAudit(tx, {
        actorType: 'SYSTEM', actionType: 'RESEARCH_EXPORT_READY', targetEntity: 'research_exports', targetId: exportId,
        newState: { status: 'READY', sheets: result.sheets.length, withdrawn_excluded: result.excluded.withdrawn }, correlationId,
      });
    }, { transaction: true });
    return { status: 'READY', ...result };
  } catch (err) {
    fs.rmSync(partPath(exportId), { force: true });
    fs.rmSync(finalPath(exportId), { force: true });
    try {
      await store.withScope(sys(), async (tx) => {
        await exportsRepo.markFailed(tx, exportId);
        await writeAudit(tx, {
          actorType: 'SYSTEM', actionType: 'RESEARCH_EXPORT_FAILED', targetEntity: 'research_exports', targetId: exportId,
          newState: { status: 'FAILED', errorCode: /^[A-Z0-9_]{2,32}$/.test(String(err.code || '')) ? err.code : 'GENERATION_FAILED' }, correlationId,
        });
      }, { transaction: true });
    } catch (e) { /* the row stays GENERATING and is visible to the operator; nothing downloadable exists either way */ }
    return { status: 'FAILED', error: err };
  }
}

/** The oldest REQUESTED export not in `skip` (the worker's queue). */
const nextRequested = (skip = []) => store.withScope(sys(), (tx) => exportsRepo.nextRequested(tx, skip));

module.exports = { request, getStatus, list, prepareDownload, claimAndGenerate, generateFile, nextRequested, buildScope, exportDir, finalPath, partPath, shape };
