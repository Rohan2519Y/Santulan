/*
 * T068 — roster parsing and validation (AT-06, AT-07). The real sample workbook must parse to 194 rows and the two
 * age-12 rows must be refused BEFORE any commit; age-18 rows are counted as EMERGING_ADULT; duplicates and blank
 * required fields are errors; and the validator output never carries name/gender/nationality/city/state/UDISE.
 *
 * Pure unit: no database. The workbook is read from docs/ (never committed on the backend tests directory).
 */
const path = require('path');
const XLSX = require('xlsx');
const { parseRoster } = require('../../../src/services/admin/roster/rosterParser');
const { validate } = require('../../../src/services/admin/roster/rosterValidator');

const SAMPLE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Creative Minds Global School- required Students Info_014006.xlsx');

const HEADER = ['Student\'s Name', 'Gender ', 'Age ', 'Nationality ', 'Current Grade', 'Section/ Course', 'Reg. Number', 'Institution Name', 'City', 'State', 'Institute Govt. ID/UDISE Code'];

/** Builds a workbook buffer that mirrors the sample template exactly (title row + header row + data rows). */
function workbook(rows) {
  const aoa = [['Student Personal Details'], HEADER, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const pupil = ({ name = 'A PUPIL', age = 15, grade = '9th-A', section = '', reg = 'REG-1' } = {}) => [name, 'Male', String(age), 'Indian', grade, section, reg, 'Test School', 'City', 'State', 'UDISE'];

describe('T068-AT06 roster workbook parsing', () => {
  it('AT-06 parses the sample roster workbook into 194 rows', () => {
    const { rows } = parseRoster(SAMPLE);
    expect(rows).toHaveLength(194);
    expect(rows[0].row).toBe(3);
    expect(rows[0].externalStudentId).toBeTruthy();
    expect(rows[0].age).toEqual(expect.any(Number));
  });

  it('AT-06 validation reports exactly the two age-12 rows as AGE_INELIGIBLE before any commit', () => {
    const { rows } = parseRoster(SAMPLE);
    const check = validate(rows);
    expect(check.ok).toBe(false);
    const ineligible = check.errors.filter((e) => e.code === 'AGE_INELIGIBLE');
    expect(ineligible).toHaveLength(2);
    ineligible.forEach((e) => expect(e.age).toBe(12));
    expect(check.rows).toEqual([]); // nothing propagates to a commit when any row is invalid
  });

  it('AT-07 the three age-18 rows are counted as EMERGING_ADULT (189 adolescents, 3 emerging adults)', () => {
    const { rows } = parseRoster(SAMPLE);
    const check = validate(rows);
    expect(check.eligible).toEqual({ ADOLESCENT: 189, EMERGING_ADULT: 3 });
  });

  it('AT-07 the validator drops name, gender, nationality, city, state and UDISE from its rows', () => {
    const { rows } = parseRoster(workbook([pupil({ reg: 'R-1001' }), pupil({ reg: 'R-1002', age: 18 })]));
    const check = validate(rows);
    expect(check.ok).toBe(true);
    expect(check.rows).toHaveLength(2);
    for (const row of check.rows) {
      expect(Object.keys(row).sort()).toEqual(['age', 'className', 'externalStudentId', 'section']);
      expect(Object.values(row).filter((v) => typeof v === 'object' && v !== null)).toEqual([]);
    }
  });
});

describe('T068-AT07 roster validation rules', () => {
  it('AT-07 a duplicate Reg. Number in the workbook is an error', () => {
    const { rows } = parseRoster(workbook([pupil({ reg: 'REG-DUP' }), pupil({ reg: 'REG-DUP' })]));
    const check = validate(rows);
    const codes = check.errors.map((e) => e.code);
    expect(codes).toContain('DUPLICATE_REG_NUMBER');
    expect(check.ok).toBe(false);
  });

  it('AT-07 blank Reg. Number and blank Current Grade are MISSING_REQUIRED errors', () => {
    const { rows } = parseRoster(workbook([pupil({ reg: '' }), pupil({ grade: '' })]));
    const check = validate(rows);
    expect(check.errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED', 'MISSING_REQUIRED']);
    expect(check.errors.map((e) => e.field)).toEqual(['Reg. Number', 'Current Grade']);
  });

  it('AT-07 a blank or non-numeric Age is an INVALID_AGE error', () => {
    const { rows } = parseRoster(workbook([pupil({ reg: 'R-BLANK', age: '' }), pupil({ reg: 'R-TEXT', age: 'monday' })]));
    const check = validate(rows);
    expect(check.errors.map((e) => e.code)).toEqual(['INVALID_AGE', 'INVALID_AGE']);
  });

  it('AT-07 age 25 is the ineligible upper bound and age 26 is refused by the same rule', () => {
    const { rows } = parseRoster(workbook([pupil({ reg: 'R-OK', age: 25 }), pupil({ reg: 'R-NO', age: 26 })]));
    const check = validate(rows);
    expect(check.ok).toBe(false);
    expect(check.eligible).toEqual({ ADOLESCENT: 0, EMERGING_ADULT: 1 });
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0].code).toBe('AGE_INELIGIBLE');
  });
});