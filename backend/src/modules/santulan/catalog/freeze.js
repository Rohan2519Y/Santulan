/*
 * Controlled release actions (BUILD 01 §12 / §12.1). Each is a SEPARATE, audited step, in this order:
 *
 *   freezeScale     needs the SIGNED-OFF anchor file and its approved SHA-256; the placeholder value is refused
 *   freezeVersions  both assessment versions, only after the scale is FROZEN and the catalog matches exactly
 *   openVersion     participation OPEN for one FROZEN version - a further audited operational change
 *   closeVersion    participation CLOSED again (always allowed on a FROZEN version)
 *
 * `testOnly` skips the signed-approval requirement, and is honoured ONLY when the connected database name contains
 * test|qual|scratch. Nothing here runs from the API: operators run scripts/santulan-freeze.js.
 */
const os = require('os');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { loadCatalogFiles } = require('./catalogFiles');
const { assertCatalogMatches, CatalogReconcileError } = require('./reconcile');

const HEX64 = /^[a-f0-9]{64}$/i;
const PLACEHOLDER = /^(0+|f+|x+|placeholder.*|replace.*|todo.*|changeme.*|<.*>)$/i;
const SCRATCH_DB = /(test|qual|scratch)/i;

const err = (m) => new CatalogReconcileError(m);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function audit(tx, { action, correlationId, operator, details }) {
  await tx.query(
    `INSERT INTO santulan.audit_logs (actor_type, actor_id, action_type, target_entity, target_id, new_state, correlation_id)
     VALUES ('SYSTEM', NULL, $1, $2, $3, $4::jsonb, $5)`,
    [action, details.entity, details.targetId || null, JSON.stringify({ operator, ...details.state }), correlationId],
  );
}

async function assertTestOnlyAllowed(tx, testOnly) {
  if (!testOnly) return false;
  const { rows } = await tx.query('SELECT current_database() AS name');
  if (!SCRATCH_DB.test(rows[0].name)) throw err(`--test-only is refused on database "${rows[0].name}" (only test|qual|scratch databases)`);
  return true;
}

/** Validates the signed-off anchor file against the approved hash; returns the parsed approval. */
function readApproval({ approvedHash, anchorsBytes, points }) {
  if (!approvedHash || PLACEHOLDER.test(approvedHash) || !HEX64.test(approvedHash)) throw err('a signed response-scale approval hash (64 hex characters) is required; the placeholder is refused');
  if (!anchorsBytes) throw err('the signed-off anchor file is required');
  if (sha256(anchorsBytes) !== approvedHash.toLowerCase()) throw err('the anchor file does not match the approved hash');
  let doc;
  try { doc = JSON.parse(anchorsBytes.toString('utf8')); } catch (e) { throw err('the anchor file is not valid JSON'); }
  const labels = doc.anchorLabels;
  const keys = labels && typeof labels === 'object' ? Object.keys(labels).sort() : [];
  const expected = Array.from({ length: points }, (_, i) => String(i + 1));
  if (JSON.stringify(keys) !== JSON.stringify(expected) || expected.some((k) => typeof labels[k] !== 'string' || labels[k].trim() === '')) {
    throw err(`anchorLabels must have a non-empty label for each of the ${points} points`);
  }
  if (!doc.keyingDefinition || typeof doc.keyingDefinition !== 'object' || !doc.keyingDefinition.POSITIVE) throw err('keyingDefinition must define POSITIVE keying');
  return doc;
}

async function freezeScale(tx, { approvedHash, anchorsBytes, testOnly = false, correlationId = randomUUID(), operator = os.userInfo().username } = {}) {
  const isTest = await assertTestOnlyAllowed(tx, testOnly);
  const { rows } = await tx.query(`SELECT response_scale_id, version, scale_points, status FROM santulan.response_scales ORDER BY created_at DESC`);
  if (rows.length !== 1) throw err(`expected exactly one response scale, found ${rows.length}`);
  const scale = rows[0];
  if (scale.status !== 'DRAFT') throw err(`the response scale is ${scale.status}, expected DRAFT`);

  let update; let params; let hash = null;
  if (isTest && !approvedHash) {
    update = `UPDATE santulan.response_scales SET status = 'FROZEN', frozen_at = now() WHERE response_scale_id = $1`;
    params = [scale.responseScaleId];
  } else {
    const approval = readApproval({ approvedHash, anchorsBytes, points: scale.scalePoints });
    hash = approvedHash.toLowerCase();
    update = `UPDATE santulan.response_scales SET status = 'FROZEN', frozen_at = now(), anchor_labels = $2::jsonb, keying_definition = $3::jsonb, content_hash = $4 WHERE response_scale_id = $1`;
    params = [scale.responseScaleId, JSON.stringify(approval.anchorLabels), JSON.stringify(approval.keyingDefinition), hash];
  }
  await tx.query(update, params);
  await audit(tx, { action: 'SCALE_FROZEN', correlationId, operator, details: { entity: 'response_scales', targetId: scale.responseScaleId, state: { version: scale.version, approvedHash: hash, testOnly: isTest && !hash } } });
  return { action: 'freeze-scale', version: scale.version, approvedHash: hash, testOnly: isTest && !hash, correlationId };
}

async function freezeVersions(tx, { files = loadCatalogFiles(), testOnly = false, correlationId = randomUUID(), operator = os.userInfo().username } = {}) {
  await assertTestOnlyAllowed(tx, testOnly);
  const versions = await assertCatalogMatches(tx, files, { scale: 'FROZEN', version: 'DRAFT', participation: 'CLOSED' });   // fails on any drift
  const frozen = [];
  for (const [label, v] of versions) {
    await tx.query(`UPDATE santulan.assessment_versions SET status = 'FROZEN', frozen_at = now() WHERE assessment_version_id = $1`, [v.assessmentVersionId]);
    await audit(tx, { action: 'ASSESSMENT_VERSION_FROZEN', correlationId, operator, details: { entity: 'assessment_versions', targetId: v.assessmentVersionId, state: { versionLabel: label, manifestSha256: files.manifestSha256 } } });
    frozen.push(label);
  }
  return { action: 'freeze-versions', versions: frozen, correlationId };
}

async function setParticipation(tx, { label, state, files = loadCatalogFiles(), correlationId = randomUUID(), operator = os.userInfo().username }) {
  const { rows } = await tx.query('SELECT assessment_version_id, status, participation_state FROM santulan.assessment_versions WHERE version_label = $1', [label]);
  const v = rows[0];
  if (!v) throw err(`unknown assessment version ${label}`);
  if (v.status !== 'FROZEN') throw err(`${label} is ${v.status}; participation can only change on a FROZEN version`);
  if (state === 'OPEN') {
    if (v.participationState === 'OPEN') throw err(`${label} is already OPEN`);
    await assertCatalogMatches(tx, files, { scale: 'FROZEN', version: 'FROZEN', participation: 'CLOSED' }, [label]);   // this version's frozen content still equals the catalog
  } else if (v.participationState === 'CLOSED') throw err(`${label} is already CLOSED`);
  await tx.query('UPDATE santulan.assessment_versions SET participation_state = $2 WHERE assessment_version_id = $1', [v.assessmentVersionId, state]);
  await audit(tx, { action: state === 'OPEN' ? 'PARTICIPATION_OPENED' : 'PARTICIPATION_CLOSED', correlationId, operator, details: { entity: 'assessment_versions', targetId: v.assessmentVersionId, state: { versionLabel: label, participationState: state } } });
  return { action: state === 'OPEN' ? 'open' : 'close', version: label, participationState: state, correlationId };
}

module.exports = {
  freezeScale, freezeVersions, openVersion: (tx, o) => setParticipation(tx, { ...o, state: 'OPEN' }), closeVersion: (tx, o) => setParticipation(tx, { ...o, state: 'CLOSED' }), readApproval,
};
