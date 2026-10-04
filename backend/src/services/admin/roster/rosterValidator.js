/*
 * Roster validation rules (spec 005 T074 / AT-06, AT-07). Runs BEFORE any write; a validation failure means the whole
 * import is refused (roster commit is all-or-nothing, T075).
 *
 *   required        Reg. Number, Student's Name, Date of Birth, Gender, Age, Current Grade
 *   hard errors     MISSING_REQUIRED, INVALID_DATE_OF_BIRTH, INVALID_AGE, AGE_INELIGIBLE, DUPLICATE_REG_NUMBER
 *   soft warnings   SECTION_BLANK (the template leaves Section/ Course empty in most schools)
 *
 * Only account and required identification fields reach the commit step. Other legacy columns are dropped here.
 */
const { resolveAgeRoute } = require('../../registration/routing');

const EXPOSED = ['externalStudentId', 'fullName', 'dateOfBirth', 'gender', 'age', 'className', 'section'];

function coerceAge(r) {
  if (r.age === null || r.age === undefined || Number.isNaN(r.age)) return null;
  return r.age;
}

function validDateOfBirth(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date <= new Date();
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
    const fullName = String(r.fullName || '').trim();
    const dateOfBirth = String(r.dateOfBirth || '').trim();
    const gender = String(r.gender || '').trim();
    const className = String(r.className || '').trim();
    const age = coerceAge(r);

    if (!externalStudentId) {
      errors.push({ row: r.row, field: 'Reg. Number', code: 'MISSING_REQUIRED' });
    } else if (seen.has(externalStudentId)) {
      errors.push({ row: r.row, field: 'Reg. Number', code: 'DUPLICATE_REG_NUMBER', duplicateOfRow: seen.get(externalStudentId) });
    } else {
      seen.set(externalStudentId, r.row);
    }

    if (!fullName) errors.push({ row: r.row, field: "Student's Name", code: 'MISSING_REQUIRED' });
    if (!dateOfBirth) errors.push({ row: r.row, field: 'Date of Birth', code: 'MISSING_REQUIRED' });
    else if (!validDateOfBirth(dateOfBirth)) errors.push({ row: r.row, field: 'Date of Birth', code: 'INVALID_DATE_OF_BIRTH' });
    if (!gender) errors.push({ row: r.row, field: 'Gender', code: 'MISSING_REQUIRED' });
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

    if (externalStudentId) clean.push({
      externalStudentId, fullName, dateOfBirth, gender, age, className,
      section: String(r.section || '').trim(), row: r.row,
    });
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
