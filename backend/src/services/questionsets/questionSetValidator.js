/*
 * Row-level validation of an uploaded question set (contracts/upload-format.md sections 2-3). ALL rows are checked and ALL
 * problems returned (the service caps what it shows at 200 and reports the total); a failing file stores nothing.
 *
 * validate({ rows, columns, ageGroup }) -> { errors, warnings, questions, versionLabel }
 * where each error is { row, column, code, message } and `questions` are normalised documents ready for canonical hashing.
 */
const framework = require('./framework');
const { OPTION_COLUMN } = require('./questionSetParser');

const LABEL = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const ITEM_CODE = /^C([1-7])-\d{2}$/;
const EN_DASH = '–';
const AGE_BANDS = [`13${EN_DASH}17`, `18${EN_DASH}25`, `13${EN_DASH}25`];
const CONTEXTS = ['General', 'School', 'College/Work', 'Digital'];
const GROUP = {
  ADOLESCENT: { bands: [`13${EN_DASH}17`, `13${EN_DASH}25`], contexts: ['School', 'General', 'Digital'], min: 13, max: 17 },
  EMERGING_ADULT: { bands: [`18${EN_DASH}25`, `13${EN_DASH}25`], contexts: ['College/Work', 'General', 'Digital'], min: 18, max: 25 },
};
const MAX_OPTIONS = 20;
const TEXT_FIELDS = ['item_code', 'assessment_version', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status'];

const isBlank = (v) => v === null || v === undefined;

function validate({ rows, columns = [], ageGroup }) {
  const errors = [];
  const warnings = [];
  const add = (row, column, code, message) => errors.push({ row, column, code, message });
  const group = GROUP[ageGroup];
  if (!group) add(null, null, 'AGE_GROUP_REQUIRED', 'Choose the age group (ADOLESCENT or EMERGING_ADULT) for this question set');

  const optionColumns = columns
    .map((name) => ({ name, m: OPTION_COLUMN.exec(name) }))
    .filter((c) => c.m)
    .map((c) => ({ name: c.name, n: Number(c.m[1]) }))
    .sort((a, b) => a.n - b.n);

  const seenCodes = new Map();
  const seenOrders = new Map();
  let label = null;
  const questions = [];

  for (const { row, cells } of rows) {
    let rowOk = true;
    const bad = (column, code, message) => { rowOk = false; add(row, column, code, message); };

    // required values and cell types
    const val = {};
    for (const f of TEXT_FIELDS) {
      const v = cells[f];
      if (isBlank(v)) { bad(f, 'REQUIRED_VALUE_MISSING', `A value is required in "${f}"`); continue; }
      if (typeof v !== 'string') { bad(f, 'CELL_TYPE_INVALID', `"${f}" must be text`); continue; }
      val[f] = v;
    }
    let order = null;
    if (isBlank(cells.display_order)) bad('display_order', 'REQUIRED_VALUE_MISSING', 'A value is required in "display_order"');
    else if (typeof cells.display_order === 'number') order = cells.display_order;
    else if (typeof cells.display_order === 'string' && /^\d+$/.test(cells.display_order)) order = Number(cells.display_order);
    else bad('display_order', 'CELL_TYPE_INVALID', '"display_order" must be a number');

    // identifiers
    if (val.item_code !== undefined) {
      const m = ITEM_CODE.exec(val.item_code);
      if (!m) bad('item_code', 'ITEM_CODE_INVALID', 'item_code must look like C4-02 (C1..C7, a dash and two digits)');
      else {
        if (seenCodes.has(val.item_code)) bad('item_code', 'ITEM_CODE_DUPLICATE', `item_code ${val.item_code} already appears in row ${seenCodes.get(val.item_code)}`);
        else seenCodes.set(val.item_code, row);
        if (val.domain_code !== undefined && `C${m[1]}` !== val.domain_code) bad('item_code', 'ITEM_CODE_INVALID', `item_code ${val.item_code} does not match domain_code ${val.domain_code}`);
      }
    }

    // version label: one label for the whole file
    if (val.assessment_version !== undefined) {
      if (!LABEL.test(val.assessment_version)) bad('assessment_version', 'VERSION_LABEL_INVALID', 'assessment_version must be 3-64 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter or digit');
      else if (label === null) label = val.assessment_version;
      else if (label !== val.assessment_version) bad('assessment_version', 'VERSION_LABEL_INCONSISTENT', `assessment_version must be the same on every row (first row uses "${label}")`);
    }

    // framework
    let domainOk = false;
    if (val.domain_code !== undefined) {
      if (!framework.DOMAIN_CODES.includes(val.domain_code)) bad('domain_code', 'DOMAIN_CODE_UNKNOWN', `domain_code must be one of ${framework.DOMAIN_CODES.join(', ')}`);
      else {
        domainOk = true;
        if (val.domain_name !== undefined && framework.DOMAIN_NAMES[val.domain_code] !== val.domain_name) bad('domain_name', 'DOMAIN_NAME_MISMATCH', `domain_name for ${val.domain_code} must be "${framework.DOMAIN_NAMES[val.domain_code]}"`);
      }
    }
    if (val.subdomain_code !== undefined) {
      const sub = framework.subdomain(val.subdomain_code);
      if (!sub) bad('subdomain_code', 'SUBDOMAIN_CODE_UNKNOWN', `${val.subdomain_code} is not one of the 72 canonical subdomain codes`);
      else {
        if (domainOk && sub.domain !== val.domain_code) bad('subdomain_code', 'SUBDOMAIN_DOMAIN_MISMATCH', `${val.subdomain_code} belongs to ${sub.domain}, not ${val.domain_code}`);
        if (val.subdomain_name !== undefined && sub.name !== val.subdomain_name) bad('subdomain_name', 'SUBDOMAIN_NAME_MISMATCH', `subdomain_name for ${val.subdomain_code} must be "${sub.name}"`);
      }
    }

    if (val.item_text !== undefined && val.item_text.length > 500) bad('item_text', 'ITEM_TEXT_TOO_LONG', 'item_text is limited to 500 characters');
    if (val.keying !== undefined && val.keying.toLowerCase() !== 'positive') bad('keying', 'KEYING_NOT_SUPPORTED', 'Only Positive keying is supported; no approved transform exists for reverse-keyed questions');

    if (val.age_band !== undefined) {
      if (!AGE_BANDS.includes(val.age_band)) bad('age_band', 'AGE_BAND_INVALID', `age_band must be one of 13${EN_DASH}17, 18${EN_DASH}25, 13${EN_DASH}25 (with an en dash)`);
      else if (group && !group.bands.includes(val.age_band)) bad('age_band', 'AGE_BAND_DOES_NOT_FIT_GROUP', `age_band ${val.age_band} does not fit the ${ageGroup} age group`);
    }
    if (val.context !== undefined) {
      if (!CONTEXTS.includes(val.context)) bad('context', 'CONTEXT_INVALID', `context must be one of ${CONTEXTS.join(', ')}`);
      else if (group && !group.contexts.includes(val.context)) bad('context', 'CONTEXT_DOES_NOT_FIT_GROUP', `context ${val.context} does not fit the ${ageGroup} age group`);
    }
    if (val.layer !== undefined && val.layer.toUpperCase() !== 'CORE') bad('layer', 'LAYER_NOT_SUPPORTED', 'Only CORE questions are supported');
    if (val.status !== undefined && val.status.toUpperCase() !== 'READY') bad('status', 'STATUS_NOT_READY', 'Only questions with status READY are accepted');

    if (order !== null) {
      if (!Number.isInteger(order) || order < 1) bad('display_order', 'DISPLAY_ORDER_INVALID', 'display_order must be a positive whole number');
      else if (seenOrders.has(order)) bad('display_order', 'DISPLAY_ORDER_DUPLICATE', `display_order ${order} already appears in row ${seenOrders.get(order)}`);
      else seenOrders.set(order, row);
    }

    // options: left to right, blanks skipped, order kept
    const options = [];
    const seenTexts = new Set();
    let beyond = false;
    for (const oc of optionColumns) {
      const v = cells[oc.name];
      if (isBlank(v)) continue;
      if (oc.n > MAX_OPTIONS) { beyond = true; continue; }
      let text;
      if (typeof v === 'string') text = v;
      else if (typeof v === 'number') text = String(v);
      else { bad(oc.name, 'CELL_TYPE_INVALID', `${oc.name} must be text`); continue; }
      if (text.length > 200) { bad(oc.name, 'OPTION_TEXT_TOO_LONG', 'An option is limited to 200 characters'); continue; }
      const key = text.toLowerCase();
      if (seenTexts.has(key)) { bad(oc.name, 'OPTION_DUPLICATE', `"${text}" appears more than once in this question`); continue; }
      seenTexts.add(key);
      options.push({ position: options.length + 1, text });
    }
    if (beyond) bad('option_21', 'OPTIONS_TOO_MANY', `A question can have at most ${MAX_OPTIONS} options`);
    if (options.length < 2 && !beyond) bad('option_1', 'OPTIONS_TOO_FEW', 'A question needs at least 2 options');

    if (rowOk && group) {
      questions.push({
        item_code: val.item_code, domain_code: val.domain_code, subdomain_code: val.subdomain_code, subdomain_name: val.subdomain_name,
        item_text: val.item_text, keying: 'POSITIVE', age_band: val.age_band, context: val.context, layer: 'CORE', pilot_status: 'READY',
        display_order: order, status: 'ACTIVE', options,
      });
    }
  }

  // domains without any question (a warning here; the freeze step checks eligibility)
  const present = new Set(rows.map((r) => (typeof r.cells.domain_code === 'string' ? r.cells.domain_code : null)));
  for (const d of framework.DOMAIN_CODES) {
    if (rows.length && !present.has(d)) warnings.push({ row: null, column: 'domain_code', code: 'DOMAIN_WITHOUT_QUESTIONS', message: `No question covers ${d} ${framework.DOMAIN_NAMES[d]}` });
  }

  return { errors, warnings, questions, versionLabel: label };
}

module.exports = { validate, GROUP, AGE_BANDS, CONTEXTS, MAX_OPTIONS };
