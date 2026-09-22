/*
 * Catalog conversion (T162; SC-014, FR-021): scripts/questions-convert-catalog.js turns the frozen BUILD 02 catalog into two
 * new-format workbooks - 175 adolescent and 171 emerging-adult questions with the five standard option labels - and both upload
 * cleanly through the normal admin path: two DRAFT sets, zero validation errors, and questionSetValidator accepts the file.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const XLSX = require('xlsx');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const store = require('../../../src/modules/santulan/store');

const { convert, toWorkbook, readSheet, HEADER, OPTIONS, FORMS, CATALOG } = require('../../../scripts/questions-convert-catalog');
const { parseQuestionWorkbook } = require('../../../src/modules/santulan/questionsets/questionSetParser');
const { validate } = require('../../../src/modules/santulan/questionsets/questionSetValidator');

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'questions-convert-catalog.js');
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'exports', 'converted');
const api = () => request(app);
const get = (p, who) => api().get(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` });

let admin;
const uploaded = [];

beforeAll(async () => {
  admin = await f.admin();
});

afterAll(async () => {
  if (uploaded.length) {
    const db = await H.admin();
    const ids = uploaded.map((u) => u.setId);
    await db.collection('items').deleteMany({ assessment_version_id: { $in: ids } });
    await db.collection('interpretation_rules').deleteMany({ assessment_version_id: { $in: ids } });
    await db.collection('assessment_versions').deleteMany({ _id: { $in: ids } });
    await db.collection('audit_logs').deleteMany({ action_type: { $regex: '^QUESTION_SET_', $options: 'i' }, target_id: { $in: ids } });
  }
  await f.cleanupFixtures();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  await store.closeClient();
  await H.closeAll();
});

function workbookRows(filePath, workingDir) {
  const wb = XLSX.readFile(path.join(workingDir, filePath));
  const ws = wb.Sheets['01_Items'];
  const [header, ...rows] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  return { header, rows, empty: Object.keys(wb.Sheets).length === 1 };
}

describe('catalog-to-workbook conversion (SC-014)', () => {
  test('the script runs end-to-end and writes the two workbook files', () => {
    expect(fs.existsSync(CATALOG)).toBe(true);
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(0, run.stderr || run.stdout);
    for (const form of FORMS) {
      const marker = path.join(OUT_DIR, '.t162');
      fs.writeFileSync(marker, '');
      expect(fs.existsSync(path.join(OUT_DIR, form.file))).toBe(true);
      const stat = fs.statSync(path.join(OUT_DIR, form.file));
      expect(stat.size).toBeGreaterThan(0);
      fs.rmSync(marker, { force: true });
    }
  });

  test('each workbook has the required sheet, header, row count and standard options', () => {
    for (const form of FORMS) {
      const { header, rows, empty } = workbookRows(form.file, OUT_DIR);
      expect(rows).toHaveLength(form.expected); // 175 and 171 questions
      const wanted = [...HEADER, ...OPTIONS.map((_, i) => `option_${i + 1}`)];
      expect(header.map((h) => String(h))).toEqual(wanted);
      expect(empty).toBe(true);
      for (const row of rows) {
        expect(String(row[7])).toBe('Positive'); // keying
        expect(String(row[11])).toBe('READY'); // status
        const options = row.slice(13, 18).map((o) => String(o));
        expect(options).toEqual(OPTIONS);
      }
    }
  });

  test('the script is deterministic: a second run re-writes byte-identical workbooks', () => {
    const before = FORMS.map((form) => fs.readFileSync(path.join(OUT_DIR, form.file)));
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    FORMS.forEach((form, i) => {
      expect(fs.readFileSync(path.join(OUT_DIR, form.file)).equals(before[i])).toBe(true);
    });
  });

  test('questionSetValidator accepts each converted file with zero problems', () => {
    for (const form of FORMS) {
      const buffer = fs.readFileSync(path.join(OUT_DIR, form.file));
      const parsed = parseQuestionWorkbook(buffer, { fileName: form.file });
      const checked = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup: form.file.includes('adolescent') ? 'ADOLESCENT' : 'EMERGING_ADULT' });
      expect([...parsed.errors, ...checked.errors]).toHaveLength(0);
      expect(parsed.rows).toHaveLength(form.expected);
    }
  });

  test('uploading both through POST /admin/question-sets gives two DRAFT sets with 0 validation errors', async () => {
    for (const form of FORMS) {
      const buffer = fs.readFileSync(path.join(OUT_DIR, form.file));
      const ageGroup = form.group === 'adolescent' ? 'ADOLESCENT' : 'EMERGING_ADULT';
      const res = await api().post('/api/v1/admin/question-sets')
        .set('Authorization', `Bearer ${admin.token}`)
        .field('ageGroup', ageGroup)
        .attach('file', buffer, { filename: form.file, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      expect(res.body.setId).toBeTruthy();
      expect(res.body.warnings || []).toEqual([]);
      const detail = await get(`/admin/question-sets/${res.body.setId}`, admin);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe('DRAFT');
      expect(detail.body.participationState).toBe('CLOSED');
      expect(detail.body.questionCount).toBe(form.expected);
      uploaded.push({ setId: res.body.setId });
    }
    expect(uploaded).toHaveLength(2);
  });
});