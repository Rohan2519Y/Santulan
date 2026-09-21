/*
 * Roster validation rules (spec 005 T074 / AT-06, AT-07). Runs BEFORE any write; a validation failure means the whole
 * import is refused (roster commit is all-or-nothing, T075).
 *
 *   required        Reg. Number (external id), Age, Current Grade
 *   hard errors     MISSING_REQUIRED, INVALID_AGE, AGE_INELIGIBLE (<13 / >25), DUPLICATE_REG_NUMBER
 *   soft warnings   SECTION_BLANK (the template leaves Section/ Course empty in most schools)
 *
 * The returned rows expose ONLY externalStudentId, age, className and section — name, gender, nationality, city,
 * state and UDISE are dropped at this boundary (AT-07: no extra identifiers propagate).
 */
const { resolveAgeRoute } = require('../../registration/routing');

const EXPOSED = ['externalStudentId', 'age', 'className', 'section'];

function coerceAge(r) {
  if (r.age === null || r.age === undefined || Number.isNaN(r.age)) return null;
  return r.age;
}

/**
 * @param {Array<object>} rows  raw parser rows (may carry extra attributes that are dropped here)
 * @returns {{ok: boolean, rows: Array<object>, errors: Array<object>, warnings: Array<object>, eligible: object}}
 */
function validate(rows) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const eligible = { ADOLESCENT: 0, EMERGING_ADULT: 0 };
  const clean = [];

  for (const r of rows) {
    const externalStudentId = String(r.externalStudentId || '').trim();
    const className = String(r.className || '').trim();
    const age = coerceAge(r);

    if (!externalStudentId) {
      errors.push({ row: r.row, field: 'Reg. Number', code: 'MISSING_REQUIRED' });
    } else if (seen.has(externalStudentId)) {
      errors.push({ row: r.row, field: 'Reg. Number', code: 'DUPLICATE_REG_NUMBER', duplicateOfRow: seen.get(externalStudentId) });
    } else {
      seen.set(externalStudentId, r.row);
    }

    if (!className) errors.push({ row: r.row, field: 'Current Grade', code: 'MISSING_REQUIRED' });

    if (age === null) {
      errors.push({ row: r.row, field: 'Age', code: 'INVALID_AGE' });
    } else {
      const route = resolveAgeRoute(age);
      if (!route.eligible) {
        errors.push({ row: r.row, field: 'Age', code: 'AGE_INELIGIBLE', age });
      } else {
        eligible[route.assessmentTrack] += 1;
      }
    }

    if (String(r.section || '').trim() === '') warnings.push({ row: r.row, field: 'Section/ Course', code: 'SECTION_BLANK' });

    if (externalStudentId) clean.push({ externalStudentId, age, className, section: String(r.section || '').trim(), row: r.row });
  }

  return {
    ok: errors.length === 0,
    rows: errors.length === 0 ? clean.map(({ row: _row, ...rest }) => rest) : [],
    errors,
    warnings,
    eligible,
  };
}

module.exports = { validate, EXPOSED };