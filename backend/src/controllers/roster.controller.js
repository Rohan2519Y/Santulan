/*
 * Roster import + one-shot credential export controllers (spec 005 T076 / contracts/api.md §US4). All routes require an
 * active SUPER_ADMIN (wired in santulan.routes.js). The upload is multipart ("roster" file + institutionId + cohortId +
 * mode) parsed by multer BEFORE this controller. Passwords are never returned in the import response - only the export
 * endpoint releases them, once.
 */
const { HttpError } = require('../errors');
const store = require('../models/db');
const { writeAudit } = require('../services/audit/auditService');
const { parseRoster } = require('../services/admin/roster/rosterParser');
const { validate: validateRows } = require('../services/admin/roster/rosterValidator');
const { commitRoster } = require('../services/admin/roster/rosterCommitService');
const { take, toXlsx } = require('../services/admin/roster/credentialExport');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRosterRequest(req) {
  const institutionId = String(req.body.institutionId || '').trim();
  const cohortId = String(req.body.cohortId || '').trim();
  const mode = String(req.body.mode || '').trim();
  if (!UUID.test(institutionId)) throw new HttpError(400, 'VALIDATION_ERROR', 'A valid institutionId is required');
  if (!UUID.test(cohortId)) throw new HttpError(400, 'VALIDATION_ERROR', 'A valid cohortId is required');
  if (mode !== 'validate' && mode !== 'commit') throw new HttpError(400, 'VALIDATION_ERROR', 'mode must be "validate" or "commit"');
  if (!req.file) throw new HttpError(400, 'VALIDATION_ERROR', 'A roster workbook file is required');
  return { institutionId, cohortId, mode };
}

async function importRoster(req, res, next) {
  try {
    const { institutionId, cohortId, mode } = readRosterRequest(req);
    const parsed = parseRoster(req.file.buffer);
    const check = validateRows(parsed.rows);

    if (mode === 'validate') {
      return res.json({ mode, ok: check.ok, errors: check.errors, warnings: check.warnings, eligible: check.eligible, rowCount: check.rows.length });
    }

    if (!check.ok) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Roster validation failed; nothing was imported', { errors: check.errors.slice(0, 25) });
    }

    const committed = await commitRoster({
      rows: parsed.rows, institutionId, cohortId,
      adminUserId: req.actor.adminUserId, correlationId: req.correlationId,
    });
    return res.status(201).json({
      mode: 'commit', status: 'COMMITTED', importId: committed.importId,
      count: committed.count, eligible: committed.eligible,
      credentialsPath: `/admin/credentials/export/${committed.importId}`,
    });
  } catch (err) { next(err); }
}

/** One-time download of the temporary credentials for a committed import. 404 once consumed or expired. */
async function exportCredentials(req, res, next) {
  try {
    // Audit FIRST: if the export cannot be audited it must not consume the entry (the operator may retry).
    await store.withScope(store.systemScope(), (tx) => writeAudit(tx, {
      actorType: 'ADMIN', actorId: req.actor.adminUserId, actionType: 'CREDENTIAL_EXPORTED',
      targetEntity: 'roster_imports', newState: { import_id: req.params.importId },
      correlationId: req.correlationId,
    }), { transaction: true });
    const rows = take(req.params.importId);
    if (!rows) throw new HttpError(404, 'NOT_FOUND', 'That credential export is unavailable or was already downloaded');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="santulan-credentials-${req.params.importId}.xlsx"`);
    return res.send(await toXlsx(rows));
  } catch (err) { next(err); }
}

module.exports = { importRoster, exportCredentials };