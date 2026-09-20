/*
 * Catalog reconcile / apply / rollback-from-receipt (contracts/catalog-import.md §4-§5, BUILD 02 §20).
 *
 * Runs inside ONE transaction supplied by the caller (`runTx(fn)`); any thrown error rolls everything back. The caller
 * provides a SYSTEM-context transaction (see ownerRunner for the CLI). No participant data is read. Failure messages name
 * the version label, item_code and field only - never item text or the bank.
 *
 *   reconcile  both versions DRAFT/CLOSED; compare every canonical field by (version_label, item_code). An exact match is a
 *              no-op (never UPDATE); any difference, extra row or missing row fails.
 *   apply      as reconcile, but inserts MISSING rows only, and only while the version is DRAFT/CLOSED and no attempt
 *              references it. Differences and extra rows still fail.
 *   rollback   deletes exactly the item ids recorded in a receipt, under the same guards.
 */
const os = require('os');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const { camelRows } = require('../../../shared/db');
const { loadCatalogFiles, verifyCatalog, itemId } = require('./catalogFiles');

class CatalogReconcileError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CatalogReconcileError';
    this.details = details;
  }
}

const MAX_LISTED = 20;
const ITEM_FIELDS = [
  ['domain_code', 'domainCode'], ['subdomain_code', 'subdomainCode'], ['subdomain_name', 'subdomainName'], ['item_text', 'itemText'],
  ['keying', 'keying'], ['age_band', 'ageBand'], ['context', 'context'], ['layer', 'layer'], ['pilot_status', 'pilotStatus'],
  ['item_content_hash', 'itemContentHash'],
];

/** Owner/technical-role runner for the CLI: one transaction with the SYSTEM actor context; rolls back on any error. */
function ownerRunner(connectionString) {
  return async (fn) => {
    const client = new Client({ connectionString });
    await client.connect();
    const tx = {
      query: async (text, params) => { const r = await client.query(text, params); return { rows: camelRows(r.rows), rowCount: r.rowCount }; },
    };
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_scope', 'SYSTEM', true)");
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      await client.end();
    }
  };
}

const list = (arr) => (arr.length > MAX_LISTED ? `${arr.slice(0, MAX_LISTED).join('; ')}; … (${arr.length} total)` : arr.join('; '));

const DRAFT_STATE = { scale: 'DRAFT', version: 'DRAFT', participation: 'CLOSED' };

async function assertPreconditions(tx, files, expect = DRAFT_STATE) {
  const tables = await tx.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE'`);
  if (tables.rows[0].n !== 28) throw new CatalogReconcileError(`expected the 28 canonical tables, found ${tables.rows[0].n}`);

  const versions = (await tx.query(
    `SELECT v.assessment_version_id, v.version_label, v.configuration, v.participant_min_age, v.participant_max_age, v.content_hash,
            v.source_file_hash, v.status, v.participation_state, s.version AS scale_version, s.status AS scale_status
       FROM santulan.assessment_versions v JOIN santulan.response_scales s USING (response_scale_id)`)).rows;
  const byLabel = new Map(versions.map((v) => [v.versionLabel, v]));
  const problems = [];
  for (const c of files.catalog) {
    const v = byLabel.get(c.version_label);
    if (!v) { problems.push(`${c.version_label}: version row missing`); continue; }
    const expected = {
      assessmentVersionId: c.assessment_version_id, configuration: c.configuration, participantMinAge: Number(c.participant_min_age),
      participantMaxAge: Number(c.participant_max_age), contentHash: c.content_hash, sourceFileHash: c.source_file_hash, scaleVersion: c.response_scale_version,
    };
    for (const [field, want] of Object.entries(expected)) if (v[field] !== want) problems.push(`${c.version_label}: ${field} differs`);
    if (v.status !== expect.version) problems.push(`${c.version_label}: status is ${v.status}, expected ${expect.version}`);
    if (v.participationState !== expect.participation) problems.push(`${c.version_label}: participation_state is ${v.participationState}, expected ${expect.participation}`);
    if (v.scaleStatus !== expect.scale) problems.push(`${c.version_label}: response scale is ${v.scaleStatus}, expected ${expect.scale}`);
  }
  if (problems.length) throw new CatalogReconcileError(`assessment version rows do not match the catalog: ${list(problems)}`, { problems });
  return byLabel;
}

/** Compares expected rows with the database; returns { diffs, missing, extra, noop, dbRows } per version label. */
async function compareItems(tx, files, versionsByLabel) {
  const result = {};
  for (const [label, expectedRows] of Object.entries(files.items)) {
    const version = versionsByLabel.get(label);
    const db = (await tx.query(
      `SELECT item_id, item_code, domain_code, subdomain_code, subdomain_name, item_text, keying, age_band, context, layer, pilot_status,
              display_order, status, item_content_hash FROM santulan.items WHERE assessment_version_id = $1`, [version.assessmentVersionId])).rows;
    const dbByCode = new Map(db.map((r) => [r.itemCode, r]));
    const expectedCodes = new Set(expectedRows.map((r) => r.item_code));
    const diffs = []; const missing = []; let noop = 0;
    for (const e of expectedRows) {
      const row = dbByCode.get(e.item_code);
      if (!row) { missing.push(e); continue; }
      const bad = [];
      if (row.itemId !== itemId(files.manifest, version.assessmentVersionId, e.item_code)) bad.push('item_id');
      for (const [csv, camel] of ITEM_FIELDS) if (row[camel] !== e[csv]) bad.push(csv);
      if (Number(row.displayOrder) !== Number(e.display_order)) bad.push('display_order');
      if (row.status !== 'ACTIVE') bad.push('status');
      if (bad.length) diffs.push(...bad.map((field) => `${label} ${e.item_code}.${field}`)); else noop += 1;
    }
    const extra = db.filter((r) => !expectedCodes.has(r.itemCode)).map((r) => r.itemCode);
    result[label] = { version, diffs, missing, extra, noop, dbRows: db.length, expectedRows: expectedRows.length };
  }
  return result;
}

const failMessage = (compared) => {
  const parts = [];
  for (const [label, r] of Object.entries(compared)) {
    if (r.diffs.length) parts.push(`different: ${list(r.diffs)}`);
    if (r.missing.length) parts.push(`missing in ${label}: ${list(r.missing.map((m) => m.item_code))}`);
    if (r.extra.length) parts.push(`extra in ${label}: ${list(r.extra)}`);
  }
  return parts.join(' | ');
};

async function assertNoAttempts(tx, compared, action) {
  for (const [label, r] of Object.entries(compared)) {
    const { rows } = await tx.query('SELECT count(*)::int AS n FROM santulan.assessment_attempts WHERE assessment_version_id = $1', [r.version.assessmentVersionId]);
    if (rows[0].n > 0) throw new CatalogReconcileError(`${action} refused: attempts already reference ${label}`);
  }
}

async function meta(tx) {
  const server = (await tx.query('SHOW server_version')).rows[0];
  let revision = null;
  try { revision = (await tx.query('SELECT name FROM public._migrations ORDER BY name DESC LIMIT 1')).rows[0]?.name || null; } catch (e) { revision = null; }
  return { dbServerVersion: server.serverVersion, migrationRevision: revision };
}

async function audit(tx, { action, correlationId, manifestSha256, operator, details }) {
  await tx.query(
    `INSERT INTO santulan.audit_logs (actor_type, actor_id, action_type, target_entity, target_id, new_state, correlation_id)
     VALUES ('SYSTEM', NULL, $1, 'assessment_versions', NULL, $2::jsonb, $3)`,
    [action, JSON.stringify({ manifestSha256, operator, ...details }), correlationId],
  );
}

/**
 * @param {object} opts
 * @param {(fn: Function) => Promise<any>} opts.runTx   supplies a transaction; a throw rolls it back
 * @param {'reconcile'|'apply'|'rollback'} [opts.mode]
 * @param {object} [opts.receipt]                       required for rollback (the receipt of an earlier apply)
 */
async function reconcileCatalog({ runTx, mode = 'reconcile', files = loadCatalogFiles(), receipt: previous = null, correlationId = randomUUID(), operator = os.userInfo().username } = {}) {
  if (!['reconcile', 'apply', 'rollback'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const startedAt = new Date().toISOString();

  const checks = verifyCatalog(files).map(({ name, result }) => ({ name, result }));
  const failedChecks = checks.filter((c) => c.result !== 'PASS');
  if (failedChecks.length) throw new CatalogReconcileError(`offline verification failed: ${failedChecks.map((c) => c.name).join('; ')}`, { checks });

  return runTx(async (tx) => {
    const versionsByLabel = await assertPreconditions(tx, files);
    const compared = await compareItems(tx, files, versionsByLabel);
    const insertedIds = Object.fromEntries(Object.keys(compared).map((l) => [l, []]));

    if (mode === 'rollback') {
      if (!previous || previous.manifestSha256 !== files.manifestSha256) throw new CatalogReconcileError('the receipt does not belong to this catalog manifest');
      await assertNoAttempts(tx, compared, 'rollback');
      for (const v of previous.versions || []) {
        for (const id of v.insertedIds || []) {
          const del = await tx.query('DELETE FROM santulan.items WHERE item_id = $1 AND assessment_version_id = $2', [id, versionsByLabel.get(v.label).assessmentVersionId]);
          if (del.rowCount !== 1) throw new CatalogReconcileError(`rollback: item ${id} of ${v.label} is not present`);
        }
      }
    } else {
      const hasDiffOrExtra = Object.values(compared).some((r) => r.diffs.length || r.extra.length);
      const hasMissing = Object.values(compared).some((r) => r.missing.length);
      if (hasDiffOrExtra || (mode === 'reconcile' && hasMissing)) throw new CatalogReconcileError(`catalog drift: ${failMessage(compared)}`, { compared: Object.keys(compared) });
      if (mode === 'apply' && hasMissing) {
        await assertNoAttempts(tx, compared, 'apply');
        for (const [label, r] of Object.entries(compared)) {
          for (const e of r.missing) {
            const id = itemId(files.manifest, r.version.assessmentVersionId, e.item_code);
            await tx.query(
              `INSERT INTO santulan.items (item_id, assessment_version_id, item_code, domain_code, subdomain_code, subdomain_name, item_text, keying,
                                          age_band, context, layer, pilot_status, display_order, status, item_content_hash)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'POSITIVE',$8,$9,'CORE',$10,$11,'ACTIVE',$12)`,
              [id, r.version.assessmentVersionId, e.item_code, e.domain_code, e.subdomain_code, e.subdomain_name, e.item_text, e.age_band, e.context, e.pilot_status, Number(e.display_order), e.item_content_hash],
            );
            insertedIds[label].push(id);
          }
        }
      }
    }

    const summary = Object.entries(compared).map(([label, r]) => ({
      label, expectedRows: r.expectedRows, dbRows: r.dbRows, insertedIds: insertedIds[label], noop: r.noop,
    }));
    const inserted = summary.reduce((n, v) => n + v.insertedIds.length, 0);
    await audit(tx, {
      action: mode === 'rollback' ? 'CATALOG_ROLLED_BACK' : 'CATALOG_RECONCILED', correlationId, manifestSha256: files.manifestSha256, operator,
      details: { mode, inserted, noop: summary.reduce((n, v) => n + v.noop, 0) },
    });

    return {
      mode, startedAt, finishedAt: new Date().toISOString(), ...(await meta(tx)), manifestSha256: files.manifestSha256,
      versions: summary, checks, derivation: { itemIdNamespace: files.manifest.itemIdNamespace }, correlationId, operator, exitCode: 0,
    };
  });
}

/**
 * Strict check used by the freeze actions: the database must equal the catalog exactly (no missing, extra or different
 * row) with the given release states, optionally for some version labels only. Throws CatalogReconcileError otherwise; returns the versions by label.
 */
async function assertCatalogMatches(tx, allFiles, expect = DRAFT_STATE, labels = null) {
  const files = labels
    ? { ...allFiles, catalog: allFiles.catalog.filter((c) => labels.includes(c.version_label)), items: Object.fromEntries(Object.entries(allFiles.items).filter(([l]) => labels.includes(l))) }
    : allFiles;
  const versions = await assertPreconditions(tx, files, expect);
  const compared = await compareItems(tx, files, versions);
  if (Object.values(compared).some((r) => r.diffs.length || r.extra.length || r.missing.length)) throw new CatalogReconcileError(`catalog drift: ${failMessage(compared)}`);
  return versions;
}

module.exports = { reconcileCatalog, assertCatalogMatches, ownerRunner, CatalogReconcileError };
