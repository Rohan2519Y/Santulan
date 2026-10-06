/*
 * Admin-triggered institution cohort report (port of the pilot kit 2's cohort_report.py). Super admin only, DRAFT only: the final
 * release gates (approver, sharing grant, safeguarding contacts, helpline date, approved content) are enforced inside
 * generateCohortReport, and this service never passes `final`, so a released copy cannot be made from here until the content owner
 * signs the wording off and a release step is added on purpose. Nothing is written to disk; the PDF is returned as a buffer.
 */
const { HttpError } = require('../../../errors');
const store = require('../../../models/db');
const { loadCohortTables } = require('./fromDatabase');
const { generateCohortReport, CohortRefusal } = require('./cohortReport');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
// serialise: each run launches a headless Chromium, so one cohort report at a time (INTEGRATION_NOTE: "one job at a time")
let chain = Promise.resolve();
const oneAtATime = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

/** @returns {Promise<{pdf: Buffer|null, manifest: object, failures: string[], warnings: string[], fileName: string}>} */
async function generate(actor, { institutionCode, cohortCode = null, enrolled = null, output = 'html' }) {
  const loaded = await store.withScope(sa(actor), (tx) => loadCohortTables(tx, institutionCode, cohortCode));
  // html / manifest: text work only, no browser (the HTML is the exact document the PDF is printed from). pdf: starts Chromium.
  const withBrowser = output === 'pdf';
  try {
    const run = () => generateCohortReport(loaded.tables, { institution: institutionCode, cohort: cohortCode, enrolled, sha: loaded.sha, final: false, pdf: withBrowser, layout: false }); // the layout was verified identical to the kit's; the PDF path loads the page once
    const r = await (withBrowser ? oneAtATime(run) : run());
    return { html: r.html, pdf: r.pdf, manifest: r.manifest, failures: r.failures, warnings: r.warnings, fileName: `${r.manifest.report_id}.${withBrowser ? 'pdf' : 'html'}` };
  } catch (err) {
    if (err instanceof CohortRefusal) throw new HttpError(422, err.code, err.message);
    throw err;
  }
}

module.exports = { generate };
