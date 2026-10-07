/*
 * Admin-triggered PDF generation using the ported pilot-kit engine (renderer.js), for one real attempt. Draft only
 * (final: false) - content.js's wording is still unapproved sample copy (CONTENT_APPROVED: false), so --final-style
 * approved PDFs are correctly out of reach here, same as in the original kit.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { HttpError } = require('../../../errors');
const store = require('../../../models/db');
const { buildStudentFromAttempt } = require('./fromAttempt');
const { chromium } = require('playwright');
const { writeAudit } = require('../../audit/auditService');
const { renderReport } = require('./renderer');

const sa = (actor) => store.superAdminScope(actor.adminUserId);

// Load control, same approach as the cohort report: one report at a time, and one shared Chromium that closes itself when idle
// (so there is no browser start-up per click and no idle memory held). The report output is unchanged.
const IDLE_MS = 60 * 1000;
let browserPromise = null; let idleTimer = null; let chain = Promise.resolve();
const sharedBrowser = () => {
  if (!browserPromise) browserPromise = chromium.launch().then((b) => { b.on('disconnected', () => { browserPromise = null; }); return b; });
  return browserPromise;
};
const scheduleClose = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => { const p = browserPromise; browserPromise = null; if (p) { try { await (await p).close(); } catch (e) { /* already closed */ } } }, IDLE_MS);
  idleTimer.unref();
};
const oneAtATime = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

/** Generates a draft PDF for one attempt. Returns { file, reportId }. Throws 422 if the attempt has no consent (REN-19). */
async function generateForAttempt(actor, attemptId, correlationId = null) {
  const student = await store.withScope(sa(actor), (tx) => buildStudentFromAttempt(tx, attemptId));
  if (!student) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (!student.consent_ok) throw new HttpError(422, 'CONSENT_NOT_VERIFIED', 'This participant does not have verified consent; no report can be generated (REN-19)');

  // G-23: the per-student PDF carries a full name; every one produced is audited (admin, attempt) before it is made.
  await store.withScope(sa(actor), (tx) => writeAudit(tx, { actorType: 'ADMIN', actorId: actor.adminUserId, actionType: 'PILOT_REPORT_EXPORTED', targetEntity: 'assessment_attempts', targetId: attemptId, correlationId }), { transaction: true });

  const outdir = path.join(os.tmpdir(), `santulan-pilot-report-${randomUUID()}`);
  const { pdfPath } = await oneAtATime(async () => {
    try { return await renderReport(student, { outdir, final: false, pdf: true, browserInstance: await sharedBrowser() }); } finally { scheduleClose(); }
  });
  return { file: pdfPath, reportId: student.report_id };
}

function cleanup(file) {
  if (!file) return;
  fs.rm(path.dirname(file), { recursive: true, force: true }, () => {});
}

module.exports = { generateForAttempt, cleanup };
