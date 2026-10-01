/*
 * Admin-triggered download of the unified report+research workbook (unifiedWorkbookWriter.js) for one question set's own
 * attempts. Synchronous (no REQUESTED/GENERATING/READY lifecycle like the de-identified research export): pilot-scale
 * data, one admin click, one file. The workbook is written to a temp file and streamed back by the controller, which
 * deletes it once sent - nothing is kept on disk between requests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const { writeUnifiedWorkbook } = require('./unifiedWorkbookWriter');

const sa = (actor) => store.superAdminScope(actor.adminUserId);
// An attempt counts once it has left the still-answering states - SUBMITTED onward, including QUALITY_HOLD/INVALID/EXPIRED
// (the unified format has an explicit report_state/attempt_status for exactly those), never CREATED/STARTED/IN_PROGRESS/PAUSED.
const NOT_YET_SUBMITTED = new Set(['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED']);

/** Generates the workbook for every attempt made against `versionId`. Returns { file, versionLabel, revision } - the
 * caller streams `file` to the admin and removes it afterwards. */
async function generateForSet(actor, versionId) {
  return store.withScope(sa(actor), async (tx) => {
    const set = await tx.c.assessment_versions.findOne({ _id: versionId });
    if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
    const attempts = await tx.c.assessment_attempts.find({ assessment_version_id: versionId }, { projection: { _id: 1, status: 1 } });
    const attemptIds = attempts.filter((a) => !NOT_YET_SUBMITTED.has(a.status)).map((a) => a._id);

    const file = path.join(os.tmpdir(), `santulan-unified-${randomUUID()}.xlsx`);
    await writeUnifiedWorkbook(file, {
      tx,
      attemptIds,
      meta: {
        readme: [
          'Santulan report + research workbook (santulan-report-research-format-v1).',
          `Source question set: ${set.version_label} r${set.revision} (${set.configuration}).`,
          'Generated on demand from the admin dashboard. Carries real names and real scores - for the report-generation pipeline, not research distribution.',
        ],
      },
    });
    return { file, versionLabel: set.version_label, revision: set.revision, attemptCount: attemptIds.length };
  });
}

/** Best-effort cleanup of the temp file once the response has been sent (or failed). */
function cleanup(file) { fs.unlink(file, () => {}); }

module.exports = { generateForSet, cleanup };
