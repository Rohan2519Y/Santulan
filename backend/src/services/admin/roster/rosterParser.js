/*
 * Roster workbook parsing (spec 005 T074 / contracts/api.md US4). Reads the sample template: a title row, a header row,
 * then one pupil per row. Header names are matched loosely (case/space-insensitive) so minor template edits do not break
 * the import. The workbook is parsed in this module but NOT validated; rosterValidator.js is the authority on rules.
 *
 * Returns rows with the RAW pupil attributes (name, gender, city, ... are kept here only so the validator can enforce
 * "no extra identifiers"; the committed rows below rosterValidator expose ONLY externalStudentId, age, className, section).
 */
const XLSX = require('xlsx');
const { HttpError } = require('../../../errors');

const HEADER_SCAN_ROWS = 12;

const CANONICAL = {
  'reg. number': 'externalStudentId',
  age: 'age',
  'current grade': 'className',
  'section/ course': 'section',
  "student's name": 'name',
  gender: 'gender',
  nationality: 'nationality',
  city: 'city',
  state: 'state',
  'institute govt. id/udise code': 'udise',
};

const normalize = (cell) => String(cell || '').replace(/\s+/g, ' ').trim().toLowerCase();

function toInteger(cell) {
  const raw = String(cell || '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
}

function findHeader(aoa) {
  const last = Math.min(aoa.length, HEADER_SCAN_ROWS);
  for (let h = 0; h < last; h += 1) {
    const header = aoa[h].map(normalize);
    const hasReg = header.some((c) => c === 'reg. number');
    const hasAge = header.some((c) => c === 'age');
    const hasGrade = header.some((c) => c === 'current grade');
    if (hasReg && hasAge && hasGrade) return { h, map: header.map((c) => CANONICAL[c] || null) };
  }
  return null;
}

/**
 * @param {Buffer|string} input  in-memory workbook buffer (multipart upload) or a filesystem path
 * @returns {{rows: Array<object>}}  raw rows keyed by canonical column, plus the 1-based workbook row number
 */
function parseRoster(input) {
  let wb;
  try {
    wb = typeof input === 'string' ? XLSX.readFile(input) : XLSX.read(input, { type: 'buffer' });
  } catch (err) {
    throw new HttpError(400, 'ROSTER_FORMAT', 'The uploaded file is not a readable Excel workbook');
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const found = findHeader(aoa);
  if (!found) throw new HttpError(400, 'ROSTER_FORMAT', 'No roster header row found (expected Reg. Number, Age and Current Grade)');

  const rows = [];
  for (let i = found.h + 1; i < aoa.length; i += 1) {
    const line = aoa[i];
    if (!line.some((cell) => String(cell || '').trim() !== '')) continue; // blank spacer rows
    const row = { row: i + 1 };
    for (let c = 0; c < found.map.length; c += 1) {
      if (!found.map[c]) continue;
      row[found.map[c]] = found.map[c] === 'age' ? toInteger(line[c]) : String(line[c] || '').trim();
    }
    rows.push(row);
  }
  return { rows };
}

module.exports = { parseRoster };