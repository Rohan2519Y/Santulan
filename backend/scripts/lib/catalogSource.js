/*
 * Shared source access for the catalog scripts (spec 005 contracts/catalog-import.md): the BUILD 02 workbook, the
 * Development Reporting Master, small CSV read/write helpers and the constants both the seed generator and the CSV
 * generator must agree on. Deterministic: no timestamps, no locale-dependent output.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { v5: uuidv5 } = require('uuid');
const { parseCsv } = require('../../src/modules/santulan/catalog/catalogFiles');

const BACKEND = path.join(__dirname, '..', '..');
const DOCS = path.join(BACKEND, '..', 'docs');
const B02 = path.join(DOCS, 'Santulan 2.0', 'BUILD_02_Frozen_Item_Bank_and_Item_Pool_Audit',
  'Santulan_BUILD_02_Assessment_Catalog_and_Item_Audit_v3_1.xlsx');
const DRM = path.join(DOCS, 'Santulan_Development_Reporting_MASTER_System_v1_1.xlsx');
const V30 = {
  adolescent: path.join(DOCS, 'Santulan 2.0', 'Santulan_Adolescent_Items_TECH_READY_v3_0.xlsx'),
  emergingadult: path.join(DOCS, 'Santulan 2.0', 'Santulan_EmergingAdult_Items_TECH_READY_v3_0.xlsx'),
};
const SEED_DIR = path.join(BACKEND, 'seeders', 'santulan');

const ITEM_ID_NAMESPACE = uuidv5('santulan.item_id.v1', uuidv5.DNS);
const SCALE_VERSION = 'santulan-capability-frequency-5pt-candidate-v3.1';
const SCALE_ANCHORS = { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' };
const SCALE_KEYING = { POSITIVE: 'item_score = response_value', REVERSE: 'NOT_APPROVED_FAIL_CLOSED' };
const SCALE_HASH = crypto.createHash('sha256').update(JSON.stringify({ scaleAnchors: SCALE_ANCHORS, scaleKeying: SCALE_KEYING })).digest('hex');

const ITEM_COLUMNS = ['version_label', 'item_code', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text',
  'source_keying', 'keying', 'age_band', 'context', 'layer', 'pilot_status', 'display_order', 'item_content_hash'];
const CATALOG_COLUMNS = ['assessment_version_id', 'version_label', 'configuration', 'participant_min_age', 'participant_max_age',
  'response_scale_version', 'content_hash', 'source_file_hash', 'status', 'participation_state'];
const SUBDOMAIN_COLUMNS = ['domain_code', 'subdomain_code', 'subdomain_name'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** SQL string literal (or NULL). */
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** Sheet -> array of objects keyed by the header row (every value a string; blank rows skipped). */
function rows(wb, sheet) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`sheet ${sheet} not found`);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const header = data[0].map((h) => String(h).trim());
  return data.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = typeof r[i] === 'string' ? r[i] : String(r[i] ?? ''); });
    return o;
  });
}

/** The v3.1 canonical content of the BUILD 02 workbook (items keep their source column names). */
function loadBuild02() {
  const wb = XLSX.readFile(B02);
  const catalog = rows(wb, '01_ASSESSMENT_CATALOG');
  if (catalog.length !== 2) throw new Error('expected 2 catalog rows');
  const itemSets = { adolescent: rows(wb, '03_ADOL_CANONICAL'), emergingadult: rows(wb, '04_EA_CANONICAL') };
  if (itemSets.adolescent.length !== 175 || itemSets.emergingadult.length !== 171) throw new Error('item counts must be 175/171');
  return { wb, catalog, itemSets, coverage: rows(wb, '06_SUBDOMAIN_COVERAGE') };
}

// ---------------------------------------------------------------------------------------------------- CSV (RFC 4180)
const needsQuote = (s) => /[",\r\n]/.test(s);
const cell = (v) => { const s = String(v ?? ''); return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** UTF-8, LF, no BOM, item text byte-exact (only quoting is applied). */
function toCsv(columns, records) {
  return `${[columns.join(','), ...records.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n')}\n`;
}

const readCsv = (file) => parseCsv(fs.readFileSync(file, 'utf8'));

module.exports = {
  BACKEND, DOCS, B02, DRM, V30, SEED_DIR, ITEM_ID_NAMESPACE, SCALE_VERSION, SCALE_ANCHORS, SCALE_KEYING, SCALE_HASH,
  ITEM_COLUMNS, CATALOG_COLUMNS, SUBDOMAIN_COLUMNS, sha256, q, rows, loadBuild02, toCsv, parseCsv, readCsv, uuidv5,
};
