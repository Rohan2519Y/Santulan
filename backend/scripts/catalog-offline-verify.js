/*
 * Offline catalog verification (contracts/catalog-import.md §4 "verify"): no database, no participant data.
 * Checks the committed files against MANIFEST.json and the frozen counts / legality rules, that they are exactly what the
 * BUILD 02 workbook generates, and the v3_0 cross-check (exactly the four documented subdomain-code differences per form).
 * Exit code 0 only when every check passes.
 *
 *   node scripts/catalog-offline-verify.js [--json]
 */
const { loadCatalogFiles, verifyCatalog } = require('../src/modules/santulan/catalog/catalogFiles');
const { buildFiles } = require('./catalog-generate-csv');
const { crossCheckV30, EXPECTED_SUBDOMAIN_CODE_DIFFS } = require('./lib/v30CrossCheck');
const fs = require('fs');
const path = require('path');
const { SEED_DIR } = require('./lib/catalogSource');

function runOfflineVerify() {
  const checks = verifyCatalog(loadCatalogFiles());

  const generated = buildFiles();
  const drift = Object.entries(generated).filter(([n, c]) => !fs.existsSync(path.join(SEED_DIR, n)) || fs.readFileSync(path.join(SEED_DIR, n), 'utf8') !== c).map(([n]) => n);
  checks.push({ name: 'committed files equal a fresh generation from the workbook', result: drift.length ? 'FAIL' : 'PASS', ...(drift.length ? { detail: drift.join(', ') } : {}) });

  const diffs = crossCheckV30();
  for (const [form, list] of Object.entries(diffs)) {
    const ok = JSON.stringify(list.map((d) => d.item_code)) === JSON.stringify(EXPECTED_SUBDOMAIN_CODE_DIFFS[form]) && list.every((d) => d.fields.length === 1 && d.fields[0] === 'subdomain_code');
    checks.push({ name: `[${form}] v3_0 cross-check: exactly 4 subdomain_code differences`, result: ok ? 'PASS' : 'FAIL', ...(ok ? {} : { detail: JSON.stringify(list) }) });
  }
  return checks;
}

if (require.main === module) {
  const checks = runOfflineVerify();
  const failed = checks.filter((c) => c.result !== 'PASS');
  if (process.argv.includes('--json')) console.log(JSON.stringify({ checks, failed: failed.length }, null, 2)); // eslint-disable-line no-console
  else {
    for (const c of failed) console.error(`FAIL  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`); // eslint-disable-line no-console
    console.log(`${checks.length - failed.length}/${checks.length} catalog checks passed`); // eslint-disable-line no-console
  }
  process.exitCode = failed.length ? 1 : 0;
}

module.exports = { runOfflineVerify };
