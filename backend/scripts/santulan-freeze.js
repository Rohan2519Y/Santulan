/*
 * Controlled release actions (BUILD 01 §12 freeze template). Each action is separate and audited (audit_logs); run them
 * in this order, only after the offline verification and a clean `catalog:reconcile`:
 *
 *   node scripts/santulan-freeze.js freeze-scale --approved-hash <sha256> --anchors <signed-off-anchors.json>
 *   node scripts/santulan-freeze.js freeze-versions
 *   node scripts/santulan-freeze.js open  --version <version_label>     (separate operational release change)
 *   node scripts/santulan-freeze.js close --version <version_label>
 *
 * The approved hash is the SHA-256 of the signed-off anchor file (`sha256sum anchors.json`); the placeholder is refused.
 * `--test-only` skips the signed approval and is honoured ONLY for databases whose name contains test|qual|scratch.
 * Connects with DATABASE_URL (the technical/owner role) under the SYSTEM actor context.
 */
require('dotenv').config();
const fs = require('fs');
const { ownerRunner, CatalogReconcileError } = require('../src/modules/santulan/catalog/reconcile');
const freeze = require('../src/modules/santulan/catalog/freeze');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const action = process.argv[2];
  if (!['freeze-scale', 'freeze-versions', 'open', 'close'].includes(action)) throw new Error('usage: santulan-freeze.js <freeze-scale|freeze-versions|open|close> [options] (see the file header)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (the technical/owner connection) is required');
  const testOnly = flag('test-only');

  // refuse before connecting when the signed approval is missing
  if (action === 'freeze-scale' && !testOnly) {
    const anchorsBytes = arg('anchors') ? fs.readFileSync(arg('anchors')) : null;
    freeze.readApproval({ approvedHash: arg('approved-hash'), anchorsBytes, points: 5 });
  }
  if ((action === 'open' || action === 'close') && !arg('version')) throw new Error(`${action} requires --version <version_label>`);

  const result = await ownerRunner(process.env.DATABASE_URL)((tx) => {
    if (action === 'freeze-scale') return freeze.freezeScale(tx, { approvedHash: arg('approved-hash'), anchorsBytes: arg('anchors') ? fs.readFileSync(arg('anchors')) : null, testOnly });
    if (action === 'freeze-versions') return freeze.freezeVersions(tx, { testOnly });
    return (action === 'open' ? freeze.openVersion : freeze.closeVersion)(tx, { label: arg('version') });
  });
  console.log(`${action} OK — ${JSON.stringify(result)}`); // eslint-disable-line no-console
}

main().catch((err) => {
  console.error(err instanceof CatalogReconcileError ? `REFUSED: ${err.message}` : err.message || err); // eslint-disable-line no-console
  process.exitCode = 1;
});
