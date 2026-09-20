/*
 * Cross-check of the generated v3.1 catalog against the on-disk v3_0 TECH_READY workbooks (contracts/catalog-import.md
 * §1): the two must differ ONLY in the four subdomain codes per form (C4.5 -> C4.4, C4.6 -> C4.5).
 */
const XLSX = require('xlsx');
const { V30, rows } = require('./catalogSource');
const { FORMS, loadCatalogFiles } = require('../../src/modules/santulan/catalog/catalogFiles');

const COMPARED = ['domain_code', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'display_order'];
const EXPECTED_SUBDOMAIN_CODE_DIFFS = {
  adolescent: ['C4-10', 'C4-11', 'C4-13', 'C4-14'],
  emergingadult: ['C4-10', 'C4-12', 'C4-13', 'C4-15'],
};

/** Returns { formKey: [{ item_code, fields: [...] }] } — one entry per row that differs from v3_0, with the differing fields. */
function crossCheckV30(dir) {
  const files = loadCatalogFiles(dir);
  const out = {};
  for (const [label, form] of Object.entries(FORMS)) {
    const old = new Map(rows(XLSX.readFile(V30[form.key]), '01_Items').map((r) => [r.item_code, r]));
    const diffs = [];
    const seen = new Set();
    for (const r of files.items[label]) {
      seen.add(r.item_code);
      const o = old.get(r.item_code);
      if (!o) { diffs.push({ item_code: r.item_code, fields: ['<missing in v3_0>'] }); continue; }
      const norm = (f, v) => (f === 'keying' ? String(v).trim().toUpperCase() : String(v).trim()); // Positive -> POSITIVE is the documented mapping
      const fields = COMPARED.filter((f) => norm(f, o[f]) !== norm(f, r[f]));
      if (fields.length) diffs.push({ item_code: r.item_code, fields });
    }
    for (const code of old.keys()) if (!seen.has(code)) diffs.push({ item_code: code, fields: ['<missing in v3.1>'] });
    out[form.key] = diffs;
  }
  return out;
}

module.exports = { crossCheckV30, EXPECTED_SUBDOMAIN_CODE_DIFFS };
