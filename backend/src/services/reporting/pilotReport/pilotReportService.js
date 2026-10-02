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
const { renderReport } = require('./renderer');

const sa = (actor) => store.superAdminScope(actor.adminUserId);

/** Generates a draft PDF for one attempt. Returns { file, reportId }. Throws 422 if the attempt has no consent (REN-19). */
async function generateForAttempt(actor, attemptId) {
  const student = await store.withScope(sa(actor), (tx) => buildStudentFromAttempt(tx, attemptId));
  if (!student) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (!student.consent_ok) throw new HttpError(422, 'CONSENT_NOT_VERIFIED', 'This participant does not have verified consent; no report can be generated (REN-19)');

  const outdir = path.join(os.tmpdir(), `santulan-pilot-report-${randomUUID()}`);
  const { pdfPath } = await renderReport(student, { outdir, final: false, pdf: true });
  return { file: pdfPath, reportId: student.report_id };
}

function cleanup(file) {
  if (!file) return;
  fs.rm(path.dirname(file), { recursive: true, force: true }, () => {});
}

module.exports = { generateForAttempt, cleanup };
