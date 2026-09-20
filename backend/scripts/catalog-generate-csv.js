/*
 * Generates the normalized catalog files of specs/005-v3-1-canonical-alignment/contracts/catalog-import.md §2 into
 * backend/seeders/santulan/ from the BUILD 02 workbook (v3.1 canonical rows). Deterministic and re-runnable:
 * UTF-8, LF, no BOM, item_text byte-exact. MANIFEST.json records every file's SHA-256 and the workbook's SHA-256
 * computed from the file on disk (the SQL/CSV packages named in the manifests are not on disk).
 *
 *   node scripts/catalog-generate-csv.js          write the files
 *   node scripts/catalog-generate-csv.js --check  compare with the committed files, exit 1 on any difference
 */
const fs = require('fs');
const path = require('path');
const {
  B02, SEED_DIR, ITEM_ID_NAMESPACE, SCALE_VERSION, SCALE_ANCHORS, SCALE_KEYING, SCALE_HASH,
  ITEM_COLUMNS, CATALOG_COLUMNS, SUBDOMAIN_COLUMNS, sha256, loadBuild02, toCsv,
} = require('./lib/catalogSource');

const GENERATOR = 'catalog-generate-csv/1';
const FILES = {
  catalog: 'assessment_catalog_v3_1.csv',
  adolescent: 'adolescent_items_v3_1.csv',
  emergingadult: 'emergingadult_items_v3_1.csv',
  subdomains: 'canonical_subdomain_reference_v3_1.csv',
  scale: 'response_scale_v3_1.json',
  manifest: 'MANIFEST.json',
};

const natural = (code) => code.replace(/^C/, '').split('.').map(Number);
const byCode = (a, b) => { const x = natural(a.subdomain_code); const y = natural(b.subdomain_code); return x[0] - y[0] || x[1] - y[1]; };

/** Returns { fileName: contents } without touching the disk. */
function buildFiles() {
  const { catalog, itemSets, coverage } = loadBuild02();

  const catalogRecords = catalog.map((c) => ({
    assessment_version_id: c.assessment_version_id, version_label: c.version_label, configuration: c.configuration,
    participant_min_age: c.participant_min_age, participant_max_age: c.participant_max_age,
    response_scale_version: c.response_scale_version, content_hash: c.assessment_content_hash_build01,
    source_file_hash: c.source_file_sha256, status: c.status, participation_state: c.participation_state,
  }));
  if (catalogRecords.some((c) => c.response_scale_version !== SCALE_VERSION)) throw new Error('catalog references an unexpected response scale version');

  const itemRecords = (list) => list.map((r) => ({ ...r, domain_name: r.domain_name_source }));

  // 72 canonical subdomains: the coverage sheet lists them per form; both forms must agree
  const perForm = new Map();
  for (const r of coverage) {
    if (!perForm.has(r.version_label)) perForm.set(r.version_label, new Map());
    perForm.get(r.version_label).set(r.subdomain_code, { domain_code: r.domain_code, subdomain_code: r.subdomain_code, subdomain_name: r.subdomain_name });
  }
  const [first, ...rest] = [...perForm.values()];
  const subdomains = [...first.values()].sort(byCode);
  if (subdomains.length !== 72) throw new Error(`expected 72 canonical subdomains, found ${subdomains.length}`);
  for (const other of rest) {
    for (const s of subdomains) {
      const o = other.get(s.subdomain_code);
      if (!o || o.subdomain_name !== s.subdomain_name || o.domain_code !== s.domain_code) throw new Error(`subdomain ${s.subdomain_code} differs between forms`);
    }
    if (other.size !== 72) throw new Error('the forms do not share the same 72 subdomains');
  }

  const files = {
    [FILES.catalog]: toCsv(CATALOG_COLUMNS, catalogRecords),
    [FILES.adolescent]: toCsv(ITEM_COLUMNS, itemRecords(itemSets.adolescent)),
    [FILES.emergingadult]: toCsv(ITEM_COLUMNS, itemRecords(itemSets.emergingadult)),
    [FILES.subdomains]: toCsv(SUBDOMAIN_COLUMNS, subdomains),
    [FILES.scale]: `${JSON.stringify({
      version: SCALE_VERSION, points: 5, anchorLabels: SCALE_ANCHORS, keyingDefinition: SCALE_KEYING, contentHash: SCALE_HASH, status: 'DRAFT',
    }, null, 2)}\n`,
  };

  const hashes = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => [n, sha256(Buffer.from(c, 'utf8'))]));
  files[FILES.manifest] = `${JSON.stringify({
    generator: GENERATOR,
    workbook: { file: path.basename(B02), sha256: sha256(fs.readFileSync(B02)) },
    itemIdNamespace: ITEM_ID_NAMESPACE,
    itemIdDerivation: 'UUIDv5(itemIdNamespace, "<assessment_version_id>:<item_code>")',
    files: hashes,
  }, null, 2)}\n`;
  return files;
}

function main() {
  const files = buildFiles();
  if (process.argv.includes('--check')) {
    const drift = Object.entries(files).filter(([n, c]) => !fs.existsSync(path.join(SEED_DIR, n)) || fs.readFileSync(path.join(SEED_DIR, n), 'utf8') !== c).map(([n]) => n);
    if (drift.length) { console.error(`catalog files differ from the workbook: ${drift.join(', ')}`); process.exitCode = 1; return; } // eslint-disable-line no-console
    console.log('catalog files match the workbook'); // eslint-disable-line no-console
    return;
  }
  fs.mkdirSync(SEED_DIR, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(SEED_DIR, n), c, { encoding: 'utf8' });
  console.log(`Wrote ${Object.keys(files).length} files to ${path.relative(process.cwd(), SEED_DIR)}`); // eslint-disable-line no-console
}

if (require.main === module) main();
module.exports = { buildFiles, FILES };
