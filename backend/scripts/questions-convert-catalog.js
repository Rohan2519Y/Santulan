#!/usr/bin/env node
/*
 * Converts the frozen BUILD 02 catalog to the new question workbook format (feature 006, T165; FR-021, SC-014), so the existing 175 + 171
 * questions can be uploaded through the normal path instead of being seeded. It reads sheets 03_ADOL_CANONICAL and 04_EA_CANONICAL and writes
 *
 *   backend/exports/converted/santulan_adolescent_v3_1.xlsx
 *   backend/exports/converted/santulan_emergingadult_v3_1.xlsx
 *
 * each with the sheet `01_Items`, the thirteen question columns and option_1..option_5 = Almost never, Rarely, Sometimes, Often, Almost always.
 *
 * What is mapped, and what is deliberately not carried:
 *   - domain_name comes from the reference framework (seeders/santulan/reference/framework.json), not from the catalog's source label
 *   - keying is written as `Positive` and status as `READY` for EVERY row; the catalog's `pilot_status` labels, `source_keying`,
 *     `item_content_hash` and `domain_name_source` are NOT carried (the upload computes its own content hash)
 *   - the five option labels are the standard scale wording used by the pilot forms
 * The output is deterministic: rows keep the catalog order and no timestamp is written into the workbook.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BACKEND = path.resolve(__dirname, '..');
const CATALOG = path.resolve(BACKEND, '..', 'docs', 'Santulan 2.0', 'BUILD_02_Frozen_Item_Bank_and_Item_Pool_Audit', 'Santulan_BUILD_02_Assessment_Catalog_and_Item_Audit_v3_1.xlsx');
const OUT_DIR = path.resolve(BACKEND, 'exports', 'converted');
const framework = require('../seeders/santulan/reference/framework.json');

const HEADER = ['item_code', 'assessment_version', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];
const OPTIONS = ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'];
const SOURCE_COLUMNS = ['version_label', 'item_code', 'domain_code', 'subdomain_code', 'subdomain_name', 'item_text', 'age_band', 'context', 'layer', 'display_order'];
const FORMS = [
  { sheet: '03_ADOL_CANONICAL', file: 'santulan_adolescent_v3_1.xlsx', expected: 175, group: 'adolescent' },
  { sheet: '04_EA_CANONICAL', file: 'santulan_emergingadult_v3_1.xlsx', expected: 171, group: 'emerging adult' },
];
const domainName = Object.fromEntries(framework.domains.map((d) => [d.code, d.name]));

/** Reads one catalog sheet into row objects keyed by the header (row 1). Throws when a needed column is missing. */
function readSheet(workbook, sheet) {
  const ws = workbook.Sheets[sheet];
  if (!ws) throw new Error(`sheet ${sheet} not found in the catalog`);
  const [header, ...rows] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const names = header.map((h) => String(h).trim());
  for (const column of SOURCE_COLUMNS) if (!names.includes(column)) throw new Error(`sheet ${sheet} has no column ${column}`);
  return rows.filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => Object.fromEntries(names.map((n, i) => [n, typeof r[i] === 'string' ? r[i].trim() : r[i]])));
}

/** The new-format rows (arrays in HEADER order + options) for one form's catalog rows. */
function convert(rows) {
  return rows.map((r) => {
    if (!domainName[r.domain_code]) throw new Error(`unknown domain ${r.domain_code} on ${r.item_code}`);
    return [
      r.item_code, r.version_label, r.domain_code, domainName[r.domain_code], r.subdomain_code, r.subdomain_name, r.item_text, 'Positive', r.age_band, r.context, r.layer, 'READY', Number(r.display_order),
      ...OPTIONS,
    ];
  });
}

/** An xlsx Buffer with the single sheet `01_Items`. No creation time is written, so the same input always gives the same bytes. */
function toWorkbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet([[...HEADER, ...OPTIONS.map((_, i) => `option_${i + 1}`)], ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '01_Items');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function main() {
  if (!fs.existsSync(CATALOG)) throw new Error(`catalog not found: ${path.relative(BACKEND, CATALOG)}`);
  const catalog = XLSX.readFile(CATALOG);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const form of FORMS) {
    const source = readSheet(catalog, form.sheet);
    if (source.length !== form.expected) throw new Error(`${form.sheet}: expected ${form.expected} questions, found ${source.length}`);
    const labels = new Set(source.map((r) => r.version_label));
    if (labels.size !== 1) throw new Error(`${form.sheet}: the version label must be identical on every row`);
    const out = path.join(OUT_DIR, form.file);
    fs.writeFileSync(out, toWorkbook(convert(source)));
    console.log(`${form.group}: ${source.length} questions x ${OPTIONS.length} options -> ${path.relative(BACKEND, out)} (label ${[...labels][0]})`); // eslint-disable-line no-console
  }
  console.log('note: keying is written as Positive and status as READY for every row; pilot_status, source_keying and the catalog content hashes are not carried.'); // eslint-disable-line no-console
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`questions-convert-catalog: ${e.message}`); process.exit(1); } // eslint-disable-line no-console
}

module.exports = { convert, toWorkbook, readSheet, HEADER, OPTIONS, FORMS, CATALOG };
