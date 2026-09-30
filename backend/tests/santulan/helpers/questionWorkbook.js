/* Builds question workbooks in memory for the upload tests (feature 006). */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const framework = require('../../../seeders/santulan/reference/framework.json');

const EN = '–';
const HEADER = ['item_code', 'assessment_version', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];
const STANDARD = ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'];
const domainName = Object.fromEntries(framework.domains.map((d) => [d.code, d.name]));

/** A valid question row ({ cells, options }). Adolescent-fitting by default. */
function row(o = {}) {
  const d = o.domain || 'C1';
  const sub = framework.subdomains.find((s) => s.domain === d);
  const cells = {
    item_code: `${d}-${String(o.n || 1).padStart(2, '0')}`, assessment_version: o.label || 'fx-upload-set-v1', domain_code: d, domain_name: domainName[d],
    subdomain_code: sub.code, subdomain_name: sub.name, item_text: `Question text ${d} ${o.n || 1}`, keying: 'Positive', age_band: `13${EN}17`, context: 'General',
    layer: 'CORE', status: 'READY', display_order: o.order || o.n || 1, ...(o.cells || {}),
  };
  const options = o.options || STANDARD;
  return { cells, options };
}

/** A complete valid set: `perDomain` questions in each of the seven domains. */
function validRows({ label = 'fx-upload-set-v1', perDomain = 1, options = STANDARD, ageGroup = 'ADOLESCENT' } = {}) {
  const rows = [];
  let order = 0;
  for (const dom of framework.domains) {
    for (let k = 1; k <= perDomain; k += 1) {
      order += 1;
      rows.push(row({ domain: dom.code, n: k, order, label, options, cells: ageGroup === 'EMERGING_ADULT' ? { age_band: `18${EN}25`, context: 'College/Work' } : {} }));
    }
  }
  return rows;
}

/** rows: [{cells, options}] or plain arrays. Returns an xlsx Buffer. */
function workbook(rows, { header = HEADER, optionColumns, sheetName = '01_Items', extraColumns = [], formulaAt = null } = {}) {
  const structured = rows.filter((r) => !Array.isArray(r) && r.options);
  const maxOptions = optionColumns !== undefined ? optionColumns : Math.max(5, ...structured.map((r) => r.options.length));
  const optNames = Array.from({ length: maxOptions }, (_, i) => `option_${i + 1}`);
  const head = [...header, ...optNames, ...extraColumns];
  const aoa = [head, ...rows.map((r) => {
    if (Array.isArray(r)) return r;
    const line = header.map((h) => (r.cells[h] === undefined ? '' : r.cells[h]));
    return [...line, ...optNames.map((_, i) => (r.options[i] === undefined ? '' : r.options[i])), ...extraColumns.map(() => '')];
  })];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (formulaAt) ws[formulaAt.cell] = { t: 'n', f: formulaAt.f, v: 0 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const docs = (name) => fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'docs', name));
const sampleFile = () => docs('Questions/Santulan_Sample_Questions.xlsx'); // moved under docs/Questions/ at some point outside git tracking
const oldFormatFile = () => docs('Santulan_Adolescent_Items_TECH_READY.xlsx');

module.exports = { HEADER, STANDARD, EN, row, validRows, workbook, sampleFile, oldFormatFile };
