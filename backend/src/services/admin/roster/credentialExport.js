/*
 * One-time, short-lived credential export store (spec 005 T076 / contracts/api.md US4): after a roster commit the
 * plaintext temporary passwords exist ONLY here, in process memory, for a short window; GET /admin/credentials/export
 * consumes the entry (single download) and it then expires from memory. Nothing is written to the database.
 */
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { escapeCell } = require('../../domain/exportRules');

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const exports_ = new Map(); // importId -> { rows: [{santulanId, temporaryPassword}], createdAt, expired }

function purge(now = Date.now()) {
  for (const [id, entry] of exports_) {
    if (entry.expired || now - entry.createdAt > DEFAULT_TTL_MS) exports_.delete(id);
  }
}

function makeImportId() {
  return `imp_${crypto.randomBytes(12).toString('base64url')}`;
}

/** Stores the plaintext credentials for a committed import; returns the id used for the single export. */
function store(rows, now = Date.now()) {
  purge(now);
  const importId = makeImportId();
  exports_.set(importId, { rows, createdAt: now });
  return importId;
}

/** Returns and removes the credentials for one download; null when unknown, expired or already consumed. */
function take(importId) {
  purge();
  const entry = exports_.get(importId);
  if (!entry) return null;
  exports_.delete(importId);
  return entry && entry.rows ? entry.rows : null;
}

// Same column headings as docs/Roster-Import-Template.xlsx (the file this import came from), so the two line up when
// read side by side, plus the two credential columns the roster file never has.
const HEADERS = [
  ["Student's Name", 'fullName'], ['Date of Birth', 'dateOfBirth'], ['Gender', 'gender'], ['Age', 'age'],
  ['Current Grade', 'className'], ['Section/ Course', 'section'], ['Reg. Number', 'externalStudentId'],
  ['Santulan ID', 'santulanId'], ['Temporary Password', 'temporaryPassword'],
];

const HEADER_FONT = { bold: true };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE1E5F2' } };
const MIN_WIDTH = 12;
const MAX_WIDTH = 45;

/** The credential file as a real workbook (bold shaded headings, each column as wide as its longest value) - a CSV
 * opens in Excel with every column at the default width and plain headings. Text goes through escapeCell so a value
 * starting with '=', '+', '-' or '@' can never run as a formula. Returns a Buffer. */
async function toXlsx(rows) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Credentials');
  const cell = (value) => (typeof value === 'number' ? value : escapeCell(value === undefined || value === null ? '' : value));

  ws.addRow(HEADERS.map(([label]) => label));
  for (const row of rows) ws.addRow(HEADERS.map(([, key]) => cell(row[key])));

  ws.getRow(1).eachCell((c) => { c.font = HEADER_FONT; c.fill = HEADER_FILL; });
  HEADERS.forEach(([label, key], i) => {
    const longest = Math.max(label.length, ...rows.map((r) => String(r[key] === undefined || r[key] === null ? '' : r[key]).length));
    ws.getColumn(i + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }]; // headings stay visible when scrolling a long roster

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { store, take, toXlsx, DEFAULT_TTL_MS };