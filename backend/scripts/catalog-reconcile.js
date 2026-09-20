/*
 * Catalog reconcile CLI (contracts/catalog-import.md §4-§5). Runs the offline verification, then the database reconcile,
 * under the technical (owner) connection DATABASE_URL with the SYSTEM actor context - never a participant credential.
 *
 *   node scripts/catalog-reconcile.js                              reconcile (default): read-only comparison + one audit event
 *   node scripts/catalog-reconcile.js --mode apply --confirm       insert MISSING rows only (DRAFT/CLOSED, no attempts)
 *   node scripts/catalog-reconcile.js --mode rollback --receipt <file> --confirm
 *
 * A receipt catalog_receipt_<timestamp>.json is written on success (release evidence). Exit code 0 only on success.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { reconcileCatalog, ownerRunner, CatalogReconcileError } = require('../src/modules/santulan/catalog/reconcile');
const { runOfflineVerify } = require('./catalog-offline-verify');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const mode = arg('mode') || 'reconcile';
  if (!['reconcile', 'apply', 'rollback'].includes(mode)) throw new Error(`--mode must be reconcile, apply or rollback (got ${mode})`);
  if (mode !== 'reconcile' && !flag('confirm')) throw new Error(`--mode ${mode} changes the database; re-run with --confirm`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (the technical/owner connection) is required');

  const failed = runOfflineVerify().filter((c) => c.result !== 'PASS');
  if (failed.length) throw new CatalogReconcileError(`offline verification failed: ${failed.map((c) => c.name).join('; ')}`);

  let previous = null;
  if (mode === 'rollback') {
    if (!arg('receipt')) throw new Error('--mode rollback requires --receipt <file>');
    previous = JSON.parse(fs.readFileSync(arg('receipt'), 'utf8'));
  }

  const receipt = await reconcileCatalog({ runTx: ownerRunner(process.env.DATABASE_URL), mode, receipt: previous });
  const stamp = receipt.finishedAt.replace(/[:.]/g, '-');
  const file = path.resolve(arg('out') || `catalog_receipt_${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  for (const v of receipt.versions) console.log(`${v.label}: expected ${v.expectedRows}, db ${v.dbRows}, unchanged ${v.noop}, inserted ${v.insertedIds.length}`); // eslint-disable-line no-console
  console.log(`${mode} OK — receipt: ${file}`); // eslint-disable-line no-console
}

main().catch((err) => {
  console.error(err instanceof CatalogReconcileError ? `FAILED: ${err.message}` : err); // eslint-disable-line no-console
  process.exitCode = 1;
});
