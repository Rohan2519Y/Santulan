/*
 * Report service (BUILD 07 sections 3, 7, 18), on the store. The state machine, wording rules and fingerprint live in
 * domain/reportRules.js; every move is a compare-and-set, so a bug here cannot publish a partial report.
 *
 *   generate:  transaction 1 begins the report (one shell per attempt; concurrent begins converge);
 *              transaction 2 renders EVERY section, stores the snapshots and completes: report REPORT_READY + content_hash and the
 *                attempt REPORT_READY together (or nothing at all);
 *              if rendering fails, transaction 2 aborts (no section persists) and transaction 3 records FAILED_RETRYABLE
 *                (the attempt stays SCORED). The growth plan is generated afterwards in its own transaction and can never fail the report.
 *   retry:     FAILED_RETRYABLE -> PENDING only; audited (RC-12); never retakes and never rescores; one transition even when two race.
 *   QUALITY_HOLD -> UNDER_REVIEW (T11), INVALID -> NOT_ELIGIBLE (T12): one fixed neutral section, identical for every reason.
 */
const { HttpError } = require('../../errors');
const config = require('../../config');
const store = require('../../models/db');
const delivery = require('../../models/repositories/delivery');
const reportsRepo = require('../../models/repositories/reports');
const identity = require('../../models/repositories/identity');
const consentsRepo = require('../../models/repositories/consents');
const consentRules = require('../domain/consentRules');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/reportRules');
const releaseFlags = require('../domain/releaseFlags');
const { renderAttempt } = require('./reportRenderer');
const { T11_UNDER_REVIEW, T12_NOT_ELIGIBLE } = require('./messages');

const NEUTRAL = {
  UNDER_REVIEW: { text: T11_UNDER_REVIEW, version: 't11-v1', type: 'T11' },
  NOT_ELIGIBLE: { text: T12_NOT_ELIGIBLE, version: 't12-v1', type: 'T12' },
};

/** G-09: true while the participant's consent gate is open (every required consent VERIFIED and none withdrawn). Checked at generation, release and every read. */
async function consentOpen(tx, participantId) {
  const participant = await identity.getParticipant(tx, participantId);
  if (!participant) return false;
  return consentRules.evaluateGate(participant, await consentsRepo.listForParticipant(tx, participantId)).open;
}

const inSystemTx = (fn) => store.withScope(store.systemScope(), fn, { transaction: true });

/** A short, non-descriptive failure code for last_error_code (never the message: it could carry content). */
const failureCode = (err) => (err && /^[A-Z0-9_]{2,32}$/.test(String(err.code || '')) ? String(err.code) : 'RENDER_FAILED');

const neutralSection = (kind) => ({ sectionType: kind, domainCode: null, contentVersion: NEUTRAL[kind].version, locale: 'en', displayOrder: 1, contentSnapshot: NEUTRAL[kind].text, released: true });

/** Transaction 1: the report shell (or the existing one). Terminal T11 / T12 shells are created complete, with their single section. */
async function begin(attemptId, correlationId) {
  return inSystemTx(async (tx) => {
    const attempt = await delivery.getAttempt(tx, attemptId);
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
    // G-09: no report of any kind is started for someone whose consent is not verified (or has been withdrawn).
    if (!(await consentOpen(tx, attempt.participantId))) throw new HttpError(422, 'CONSENT_NOT_VERIFIED', 'The participant does not have verified consent; no report is generated');
    const existing = await reportsRepo.getByAttempt(tx, attemptId);
    if (existing) {
      if (existing.reportVersion !== config.reportVersion) throw new HttpError(409, 'INVALID_STATE', `The attempt already has report version ${existing.reportVersion}; a second version needs a governed replacement workflow`);
      return existing;
    }
    if (attempt.status === 'SCORED') {
      return reportsRepo.insertReport(tx, { participantId: attempt.participantId, attemptId, reportVersion: config.reportVersion, reportType: 'STANDARD', status: 'PENDING' });
    }
    const kind = attempt.status === 'QUALITY_HOLD' ? 'UNDER_REVIEW' : attempt.status === 'INVALID' ? 'NOT_ELIGIBLE' : null;
    if (!kind) throw new HttpError(422, 'INVALID_STATE', `A report starts from a scored, held or invalid attempt (attempt is ${attempt.status})`);
    const section = neutralSection(kind);
    const report = await reportsRepo.insertReport(tx, {
      participantId: attempt.participantId, attemptId, reportVersion: config.reportVersion, reportType: NEUTRAL[kind].type, status: kind, generatedAt: new Date(), contentHash: rules.fingerprint([section]),
    });
    await reportsRepo.insertSections(tx, report.reportId, [section]);
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'REPORT_GENERATED', targetEntity: 'reports', targetId: report.reportId, newState: { state: kind }, correlationId });
    return report;
  });
}

/** Transaction 2: render, store and complete a PENDING report. Throws when rendering fails (the transaction then leaves nothing). */
async function renderAndComplete(reportId, { renderer = renderAttempt, correlationId } = {}) {
  return inSystemTx(async (tx) => {
    const report = await reportsRepo.getReport(tx, reportId);
    if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    if (report.generationStatus !== 'PENDING') return { state: report.generationStatus, retryCount: report.retryCount, skipped: true };
    const sections = await renderer(tx, report.attemptId);
    if (!sections.some((s) => s.sectionType === 'PROFILE')) throw new HttpError(500, 'INTERNAL_ERROR', 'A report is complete only after its PROFILE snapshot exists');
    // G-04: a finished report is NOT visible to the student. Every section is stored unreleased; an admin reviews the report and releases
    // it (releaseReport below). The fingerprint is taken from the rendered sections, so the content hash is unchanged by this.
    await reportsRepo.insertSections(tx, reportId, sections.map((s) => ({ ...s, released: false })));
    const hash = rules.fingerprint(sections);
    if (!(await reportsRepo.moveReport(tx, reportId, 'PENDING', { generation_status: 'REPORT_READY', generated_at: new Date(), content_hash: hash }))) {
      throw new HttpError(409, 'INVALID_STATE', 'The report changed while completing; try again');
    }
    await delivery.moveAttempt(tx, report.attemptId, 'SCORED', { status: 'REPORT_READY' });
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'REPORT_GENERATED', targetEntity: 'reports', targetId: reportId, newState: { state: 'REPORT_READY', sections: sections.length, retryCount: report.retryCount }, correlationId });
    return { state: 'REPORT_READY', retryCount: report.retryCount, attemptId: report.attemptId };
  });
}

/** Transaction 3: record the failure (PENDING -> FAILED_RETRYABLE); the attempt stays SCORED. */
async function recordFailure(reportId, code, correlationId) {
  return inSystemTx(async (tx) => {
    const report = await reportsRepo.getReport(tx, reportId);
    if (!report || report.generationStatus === 'FAILED_RETRYABLE') return report;
    if (!(await reportsRepo.moveReport(tx, reportId, 'PENDING', { generation_status: 'FAILED_RETRYABLE', last_error_code: code.slice(0, 64), last_error_at: new Date() }))) return report;
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'REPORT_FAILED', targetEntity: 'reports', targetId: reportId, newState: { state: 'FAILED_RETRYABLE', errorCode: code, retryCount: report.retryCount }, correlationId });
    return reportsRepo.getReport(tx, reportId);
  });
}

/** After a completed report: generate the growth plan in its own transaction; a failure there never affects the report. */
async function afterComplete(attemptId, correlationId) {
  try {
    const { generatePlanSafely } = require('../growth/growthService'); // eslint-disable-line global-require
    await generatePlanSafely(attemptId, { correlationId });
  } catch (err) { /* the plan is optional and hidden; the report is already complete */ }
}

async function run(reportId, { renderer, correlationId }) {
  try {
    const done = await renderAndComplete(reportId, { renderer, correlationId });
    if (done.state === 'REPORT_READY' && !done.skipped) await afterComplete(done.attemptId, correlationId);
    return done;
  } catch (err) {
    await recordFailure(reportId, failureCode(err), correlationId);
    return null;
  }
}

/** Generates (or converges on) the report of an attempt. */
async function generateReport(attemptId, { correlationId, renderer } = {}) {
  let report;
  for (let i = 0; i < 3; i += 1) {
    try { report = await begin(attemptId, correlationId); break; } catch (err) {
      if (!(err && err.code === 'INVALID_STATE' && err.cause) || i === 2) throw err; // a lost begin race resolves on the next pass
    }
  }
  if (report.generationStatus === 'PENDING') await run(report.reportId, { renderer, correlationId });
  const after = await inSystemTx((tx) => reportsRepo.getReport(tx, report.reportId));
  return { reportId: after.reportId, state: after.generationStatus, retryCount: after.retryCount };
}

/** Controlled retry of a FAILED_RETRYABLE report: audited, one transition even when two requests race, no retake and no rescore. */
async function retryReport(reportId, { correlationId, renderer, actorType = 'SYSTEM', actorId = null } = {}) {
  await inSystemTx(async (tx) => {
    const report = await reportsRepo.getReport(tx, reportId);
    if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    if (report.generationStatus !== 'FAILED_RETRYABLE') throw new HttpError(409, 'INVALID_STATE', `Only a failed report can be retried (report is ${report.generationStatus})`);
    if (!(await reportsRepo.moveReport(tx, reportId, 'FAILED_RETRYABLE', { generation_status: 'PENDING' }, { $inc: { retry_count: 1 } }))) throw new HttpError(409, 'INVALID_STATE', 'The report is already being retried');
    const attempt = await delivery.getAttempt(tx, report.attemptId);
    await delivery.appendEvent(tx, attempt, { event_type: 'REPORT_RETRY', session_number: null, metadata: { report_id: reportId, retry_count: report.retryCount + 1 } });
    await writeAudit(tx, { actorType, actorId, actionType: 'REPORT_RETRIED', targetEntity: 'reports', targetId: reportId, previousState: { state: 'FAILED_RETRYABLE' }, newState: { state: 'PENDING', retryCount: report.retryCount + 1 }, correlationId });
  });
  await run(reportId, { renderer, correlationId });
  const after = await inSystemTx((tx) => reportsRepo.getReport(tx, reportId));
  return { reportId, state: after.generationStatus, retryCount: after.retryCount };
}

/**
 * Participant retrieval (AT-18, RC-10): the participant's own report, released sections only, and only in REPORT_READY / T11 / T12.
 * Anything else - PENDING, FAILED_RETRYABLE, another participant's report - is the same 404 REPORT_NOT_READY. PRIORITY / ACTION
 * sections appear only while the developmentRelease switch is ON.
 */
async function getParticipantReport(participantId, reportId) {
  const owned = await store.withScope(store.participantScope(participantId), (tx) => reportsRepo.getReport(tx, reportId));
  if (!owned || !rules.PARTICIPANT_VISIBLE.has(owned.generationStatus)) throw new HttpError(404, 'REPORT_NOT_READY', 'The report is not available yet');
  return store.withScope(store.systemScope(), async (tx) => {
    // G-09: re-checked on every read, so a participant who withdraws consent after a report was released stops seeing it at once.
    if (!(await consentOpen(tx, participantId))) throw new HttpError(404, 'REPORT_NOT_READY', 'The report is not available yet');
    const switches = await releaseFlags.getSwitches(tx);
    const all = await reportsRepo.sectionsOf(tx, reportId);
    // G-04: only sections an admin has released are ever shown; the release switches then still decide which layers may appear.
    const shown = all.filter((s) => s.isReleasedToParticipant && rules.isReleasable(s.sectionType, switches));
    // `released` tells the student screen whether to show the report or "being checked": a finished report stays unreleased until an admin releases it.
    // The neutral T11 / T12 notices keep their original shape (always shown); only a finished report carries the flag.
    const released = all.some((s) => s.isReleasedToParticipant);
    return {
      reportId: owned.reportId,
      state: owned.generationStatus,
      ...(owned.generationStatus === 'REPORT_READY' ? { released } : {}),
      sections: shown.map((s) => ({ type: s.sectionType, ...(s.domainCode ? { domain: s.domainCode } : {}), locale: s.locale, contentVersion: s.contentVersion, order: s.displayOrder, content: s.contentSnapshot })),
    };
  });
}

/** The release state of an attempt's report, for the admin review screen. */
async function reportStatusForAttempt(attemptId) {
  return inSystemTx(async (tx) => {
    const report = await reportsRepo.getByAttempt(tx, attemptId);
    if (!report) return { exists: false };
    const sections = await reportsRepo.sectionsOf(tx, report.reportId);
    const releasedCount = sections.filter((s) => s.isReleasedToParticipant).length;
    return {
      exists: true, reportId: report.reportId, state: report.generationStatus, reportType: report.reportType,
      sectionCount: sections.length, releasedCount,
      // REPORT_READY is the only state that needs a release decision; T11 / T12 notices are neutral and always shown.
      needsRelease: report.generationStatus === 'REPORT_READY', released: report.generationStatus === 'REPORT_READY' && releasedCount > 0,
    };
  });
}

/**
 * G-04: the admin's review-and-release step. A finished (REPORT_READY) report is invisible to the student until this runs. It checks the
 * participant's consent gate first (a report is never released for someone whose consent is not verified), flips every section to released,
 * and writes an audit row naming the admin and the time. Releasing twice is refused; the release switches still decide which layers show.
 */
async function releaseReport(reportId, { actorId, correlationId }) {
  return inSystemTx(async (tx) => {
    const report = await reportsRepo.getReport(tx, reportId);
    if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    if (report.generationStatus !== 'REPORT_READY') throw new HttpError(409, 'INVALID_STATE', `Only a finished report can be released (report is ${report.generationStatus})`);
    if (!(await consentOpen(tx, report.participantId))) throw new HttpError(422, 'CONSENT_NOT_VERIFIED', 'This participant does not have verified consent; the report cannot be released');
    const changed = await reportsRepo.setSectionsReleased(tx, reportId, true);
    if (!changed) throw new HttpError(409, 'ALREADY_RELEASED', 'This report has already been released');
    await writeAudit(tx, { actorType: 'ADMIN', actorId, actionType: 'REPORT_RELEASED', targetEntity: 'reports', targetId: reportId, previousState: { released: false }, newState: { released: true, sections: changed }, correlationId });
    return { reportId, released: true, sections: changed };
  });
}

/** Takes a released report back from the student (the sections go back to unreleased). Audited. */
async function holdReport(reportId, { actorId, correlationId }) {
  return inSystemTx(async (tx) => {
    const report = await reportsRepo.getReport(tx, reportId);
    if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found');
    if (report.generationStatus !== 'REPORT_READY') throw new HttpError(409, 'INVALID_STATE', `Only a finished report can be held back (report is ${report.generationStatus})`);
    const changed = await reportsRepo.setSectionsReleased(tx, reportId, false);
    if (!changed) throw new HttpError(409, 'NOT_RELEASED', 'This report is not released');
    await writeAudit(tx, { actorType: 'ADMIN', actorId, actionType: 'REPORT_HELD', targetEntity: 'reports', targetId: reportId, previousState: { released: true }, newState: { released: false, sections: changed }, correlationId });
    return { reportId, released: false, sections: changed };
  });
}

/** Attempts that need a report step (the worker's queue). */
async function findAttemptsNeedingReport({ skip = [], limit = 1 } = {}) {
  return store.withScope(store.systemScope(), async (tx) => {
    const candidates = await tx.c.assessment_attempts.find(
      { status: { $in: ['SCORED', 'QUALITY_HOLD', 'INVALID'] }, submitted_at: { $ne: null }, _id: { $nin: skip } }, { sort: { submitted_at: 1 }, limit: 200 },
    );
    const out = [];
    for (const a of candidates) {
      if (!(await consentOpen(tx, a.participant_id))) continue; // G-09: nothing is generated for a participant without verified consent
      const r = await reportsRepo.getByAttempt(tx, a._id);
      if (!r || (a.status === 'SCORED' && r.generationStatus === 'PENDING')) out.push(a._id);
      if (out.length >= limit) break;
    }
    return out;
  });
}

module.exports = { generateReport, retryReport, getParticipantReport, reportStatusForAttempt, releaseReport, holdReport, findAttemptsNeedingReport, NEUTRAL };
