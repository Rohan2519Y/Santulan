/*
 * Research export end to end (T137; AT-20, AT-21, AT-28, AT-30, B08-024..083): a populated scratch database is exported through the
 * real endpoints and the real worker (claimAndGenerate), and every sheet of the downloaded workbook is cross-checked against the
 * database it was written from. Generation runs to a scratch temp directory; downloads stream the file and never a path.
 */
process.env.EXPORT_DIR = require('path').join(require('os').tmpdir(), `santulan-export-t137-${process.pid}`);

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const request = require('supertest');
const XLSX = require('xlsx');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { v4: uuidv4 } = require('uuid');
const RULES_SHEETS = require('../../../src/modules/santulan/research/workbookWriter').SHEETS;
const { TRUNCATION_MARKER } = require('../../../src/modules/santulan/domain/exportRules');
const { FORBIDDEN_COLUMNS } = require('../../../src/modules/santulan/research/researchIdentity');
const store = require('../../../src/modules/santulan/store');
const { claimAndGenerate } = require('../../../src/modules/santulan/research/exportService');

const EXPORT_DIR = process.env.EXPORT_DIR;
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const auth = (who) => ({ Authorization: `Bearer ${who.token}` });
const post = (p, who, body) => api().post(`/api/v1${p}`).set(auth(who)).send(body);
const get = (p, who) => api().get(`/api/v1${p}`).set(auth(who));
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);

let S;
let admin;
const exportIds = [];

let db;
const u = () => f.u();
const claimKey = (label) => `T137-${label}-${u()}-${u()}`;

/** An institutionalised OPEN-marked participant with a token minted like the server would; verified consents as an institutional minor needs. */
async function iPart({ institution_id, cohort_id, status = 'ACTIVE', age = 16 }) {
  const doc = F.participant({ participation_route: 'INSTITUTIONAL', institution_id, cohort_id, status, age_years_at_registration: age, assessment_track: 'ADOLESCENT' });
  await db.collection('participants').insertOne(doc);
  const specs = doc.is_minor ? [['PARENT_GUARDIAN_CONSENT', 'PARENT'], ['STUDENT_ASSENT', 'SELF']] : [['ADULT_SELF_CONSENT', 'SELF']];
  for (const [type, giver] of specs) {
    await db.collection('consents').insertOne(F.verifiedConsent(doc._id, { consent_type: type, giver_relationship: giver, protocol_version: 'TEST-PROTOCOL-1', verification_method: 'TEST_METHOD_A' }));
  }
  return { participantId: doc._id, token: f.participantToken(doc._id), santulanId: doc.santulan_id, status };
}

/** Creates an attempt through the endpoint (201), answers every question and returns the attempt id. */
async function attemptFor(p) {
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const id = created.body.attemptId;
  expect((await post(`/attempts/${id}/sessions/resume`, p)).status).toBe(200);
  await f.answerAll(id, () => '3');
  return id;
}

/** A scored attempt: answers -> submit -> quality -> score through the real endpoints. */
async function scoredAttempt(p) {
  const id = await attemptFor(p);
  expect((await post(`/attempts/${id}/submit`, p, { submissionKey: `sub-${u()}-${u()}` })).status).toBe(200);
  expect((await internal('post', `/internal/attempts/${id}/quality`, {})).body.outcome).toBe('CLEAR');
  expect((await internal('post', `/internal/attempts/${id}/score`, { scoringVersion: 'domain-mean-v1' })).body.outcome).toBe('SCORED');
  return id;
}

/** Claims an export over HTTP and drives the worker exactly once. Returns { status, body }. */
async function claim(who, key, payload = {}) {
  return api().post('/api/v1/research-exports')
    .set(auth(who)).set('Idempotency-Key', key).send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1', ...payload });
}

async function claimAndGenerateOne(key, payload) {
  const res = await claim(admin, key, payload);
  expect(res.status).toBe(202);
  const body = res.body;
  expect(body.status).toBe('REQUESTED');
  const done = await claimAndGenerate(body.exportId);
  expect(done.status).toBe('READY');
  exportIds.push(body.exportId);
  const status = (await get(`/research-exports/${body.exportId}`, admin)).body;
  expect(status.status).toBe('READY');
  return { ...body, ...status };
}

const download = (id, who = admin) => api().get(`/api/v1/research-exports/${id}/download`)
  .set(auth(who)).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function workbookOf(id, who = admin) {
  const res = await download(id, who);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('spreadsheetml');
  return res;
}

const sheetOf = (wb, name) => {
  const ws = wb.Sheets[name];
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) : null;
};
const dataRows = (sheet) => (sheet || []).slice(1).filter((r) => r.some((c) => c !== null && c !== undefined && c !== ''));
const itemResponseRows = (wb) => Object.keys(wb.Sheets).filter((n) => n.startsWith('ITEM_RESPONSES'))
  .reduce((sum, n) => sum + dataRows(sheetOf(wb, n)).length, 0);

/** Mirrors exportService.buildScope + the identity policy so workbook counts can be compared with the database they came from. */
async function expectedCounts({ institutionId, cohortId, status, dateFrom, dateTo, allVersions = false } = {}) {
  const attemptFilter = { assessment_version_id: S.setId };
  if (dateFrom || dateTo) {
    attemptFilter.created_at = {};
    if (dateFrom) attemptFilter.created_at.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) attemptFilter.created_at.$lt = new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() + 24 * 3600 * 1000);
  }
  const attempts = await db.collection('assessment_attempts').find(attemptFilter, { projection: { _id: 1, participant_id: 1 } }).toArray();
  const person = {};
  if (institutionId) person.institution_id = institutionId;
  if (cohortId) person.cohort_id = cohortId;
  if (status) person.status = status;
  const people = await db.collection('participants').find({ ...person, _id: { $in: [...new Set(attempts.map((a) => a.participant_id))] } }, { projection: { _id: 1, status: 1 } }).toArray();
  const allowed = people.filter((p) => p.status !== 'WITHDRAWN');
  const allowedIds = new Set(allowed.map((p) => p._id));
  const allowedAttempts = attempts.filter((a) => allowedIds.has(a.participant_id));
  const respFilter = { attempt_id: { $in: allowedAttempts.map((a) => a._id) } };
  if (!allVersions) respFilter.is_current = true;
  const count = (coll, filter) => db.collection(coll).countDocuments(filter);
  return {
    attempts: allowedAttempts.length, participants: allowed.length, withdrawn: people.length - allowed.length,
    responses: await count('responses', respFilter),
    scores: await count('score_results', { attempt_id: { $in: allowedAttempts.map((a) => a._id) } }),
    events: await count('response_events', { attempt_id: { $in: allowedAttempts.map((a) => a._id) } }),
    quality: await count('quality_flags', { attempt_id: { $in: allowedAttempts.map((a) => a._id) } }),
  };
}

function metadataRows(wb) {
  return dataRows(sheetOf(wb, 'EXPORT_METADATA'));
}
const metadataValue = (wb, key) => {
  const row = metadataRows(wb).find((r) => String(r[0]) === key);
  return row ? String(row[1]) : undefined;
};

/** How many data rows the sheet actually carries. */
const rowsOf = (wb, name) => dataRows(sheetOf(wb, name)).length;
const itemResponsesOf = (wb, name) => {
  const rows = dataRows(sheetOf(wb, name));
  return rows;
};

const dated = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await H.admin();
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  admin = await f.admin();
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const instA = await f.institution('ACTIVE');
  const cohA = await f.cohort(instA, 'ACTIVE');
  const instB = await f.institution('ACTIVE');
  const cohB = await f.cohort(instB, 'ACTIVE');

  // text a spreadsheet could read as a formula: the export must escape it (B08-033)
  const formulaInst = F.institution({ institution_code: '=EVAL(0)' });
  await db.collection('institutions').insertOne(formulaInst);
  await db.collection('cohorts').insertOne(F.cohort(formulaInst._id, { cohort_code: '+CMD(1)' }));

  const oldA = await iPart({ institution_id: instA, cohort_id: cohA });
  const oldAttempt = await scoredAttempt(oldA);
  await db.collection('assessment_attempts').updateOne({ _id: oldAttempt }, { $set: { created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) } });
  await db.collection('responses').updateMany({ attempt_id: oldAttempt }, { $set: { answered_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) } });
  const eventsT = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  await db.collection('response_events').insertMany([
    F.responseEvent(oldAttempt, { event_type: 'QUALITY_CHECK_COMPLETED', occurred_at: eventsT, metadata: { notes: 'x'.repeat(40000) } }),
    F.responseEvent(oldAttempt, { event_type: 'REPORT_RETRY', occurred_at: eventsT, metadata: { note: 'ordinary long-running event metadata' } }),
    F.responseEvent(oldAttempt, { event_type: 'SESSION_START', occurred_at: eventsT }),
  ]);

  const A = [];
  for (let i = 0; i < 6; i += 1) { const p = await iPart({ institution_id: instA, cohort_id: cohA }); A.push(p); await scoredAttempt(p); }
  const B = [];
  for (let i = 0; i < 4; i += 1) { const p = await iPart({ institution_id: instB, cohort_id: cohB }); B.push(p); await scoredAttempt(p); }

  // version-2 supersession on the first B attempt: v1 stays in the archive, only v2 "counts"
  const bParts = await db.collection('assessment_attempts').find({ participant_id: B[0].participantId }, { projection: { _id: 1 } }).toArray();
  const bAttempt = bParts[0]._id;
  const oldDocs = await db.collection('responses').find({ attempt_id: bAttempt }).toArray();
  const replacements = oldDocs.map((r) => ({ ...r, _id: uuidv4(), response_version: 2, is_current: true, supersedes_response_id: r._id, idempotency_key: `fx-v2-${u()}` }));
  await db.collection('responses').updateMany({ attempt_id: bAttempt }, { $set: { is_current: false } });
  await db.collection('responses').insertMany(replacements);

  // one OPEN, never-submitted attempt with quality flags (Q03 + Q07) and a couple of events
  const openP = await iPart({ institution_id: instB, cohort_id: cohB });
  const openAttempt = await attemptFor(openP);
  await db.collection('quality_flags').insertMany([
    F.qualityFlag(openAttempt, { flag_code: 'Q03', severity: 'MEDIUM', disposition: 'UNREVIEWED' }),
    F.qualityFlag(openAttempt, { flag_code: 'Q07', severity: 'LOW', disposition: 'UNREVIEWED' }),
  ]);
  await db.collection('response_events').insertMany([
    F.responseEvent(openAttempt, { event_type: 'SESSION_START', session_number: 1 }),
    F.responseEvent(openAttempt, { event_type: 'SESSION_END', session_number: 2 }),
  ]);

  // two participants score and only later withdraw: exported as excluded, never as rows
  const W = [];
  for (let i = 0; i < 2; i += 1) {
    const p = await iPart({ institution_id: instA, cohort_id: cohA });
    await scoredAttempt(p);
    await db.collection('participants').updateOne({ _id: p.participantId }, { $set: { status: 'WITHDRAWN' } });
    W.push(p.santulanId);
  }
  global.T137_SCOPE = { instA, cohA, instB, cohB, oldA: oldA.participantId, oldAttempt, openAttempt, B, W, A };
});

afterAll(async () => {
  await f.closeOpenSets();
  await f.cleanupFixtures();
  const z = global.T137_SCOPE;
  if (z) {
    await db.collection('research_exports').deleteMany({ _id: { $in: exportIds } });
    await db.collection('participant_cohort_history').deleteMany({ participant_id: { $in: [z.oldA, ...z.A.map((p) => p.participantId), ...z.B.map((p) => p.participantId)] } });
  }
  await db.collection('cohorts').deleteMany({ cohort_code: '+CMD(1)' });
  await db.collection('institutions').deleteMany({ institution_code: '=EVAL(0)' });
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  await store.closeClient();
  await H.closeAll();
});

const master = async () => claimAndGenerateOne(claimKey('master'), {}).then(async (e) => ({ e, wb: XLSX.read((await workbookOf(e.exportId)).body, { type: 'buffer' }) }));
const filtered = async (label, payload) => claimAndGenerateOne(claimKey(label), payload).then(async (e) => ({ e, wb: XLSX.read((await workbookOf(e.exportId)).body, { type: 'buffer' }) }));

describe('research export request and worker lifecycle (B08-024, B08-028, B08-038, B08-049..B08-053, B08-069)', () => {
  test('B08-024 two exports can be claimed and generated in parallel', async () => {
    const [a, b] = await Promise.all([claim(admin, claimKey('par-a'), {}), claim(admin, claimKey('par-b'), {})]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const [da, db_] = await Promise.all([claimAndGenerate(a.body.exportId), claimAndGenerate(b.body.exportId)]);
    expect(da.status).toBe('READY');
    expect(db_.status).toBe('READY');
    expect(a.body.exportId).not.toBe(b.body.exportId);
    exportIds.push(a.body.exportId, b.body.exportId);
  });

  test('B08-028 a key can be claimed exactly once even under concurrency', async () => {
    // Same key, same payload, genuinely simultaneous: the loser detects the winner's deterministic-id write conflict
    // (IDEMPOTENCY_RACE), retries internally, and re-reads the winner's committed outcome - the documented replay
    // semantics of shared/idempotency.js ("same key + same payload => replay"), so the loser is a 200, not a 409
    // (409 is reserved for the same key with a DIFFERENT payload, covered by B08-050).
    const key = claimKey('once');
    const [a, b] = await Promise.all([claim(admin, key, {}), claim(admin, key, {})]);
    const ok = [a, b].filter((r) => r.status === 202);
    const dup = [a, b].filter((r) => r.status !== 202);
    expect(ok).toHaveLength(1);
    expect(dup).toHaveLength(1);
    expect(dup[0].status).toBe(200);
    expect(dup[0].body.exportId).toBe(ok[0].body.exportId); // only one export document was ever created for this key
    const exportId = ok[0].body.exportId;
    exportIds.push(exportId);
    const done = await claimAndGenerate(exportId);
    expect(done.status).toBe('READY');
    const started = await db.collection('audit_logs').countDocuments({ action_type: 'RESEARCH_EXPORT_STARTED', target_id: exportId });
    expect(started).toBe(1);
  });

  test('B08-038 re-submitting the same key with the same payload is a replay (200) of the same export', async () => {
    const key = claimKey('replay');
    const first = await claim(admin, key, { filters: { participantStatus: 'ACTIVE' } });
    expect(first.status).toBe(202);
    exportIds.push(first.body.exportId);
    await claimAndGenerate(first.body.exportId);
    const again = await claim(admin, key, { filters: { participantStatus: 'ACTIVE' } });
    expect(again.status).toBe(200);
    expect(again.body.exportId).toBe(first.body.exportId);
  });

  test('B08-050 the same key with a different payload is a 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = claimKey('conflict');
    expect((await claim(admin, key, { filters: { participantStatus: 'ACTIVE' } })).status).toBe(202);
    const other = await claim(admin, key, { filters: { participantStatus: 'SUSPENDED' } });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('B08-049 a too-short Idempotency-Key is a 400 validation error', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).set('Idempotency-Key', 'short').send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1' });
    expect(res.status).toBe(400);
  });

  test('B08-069 a missing Idempotency-Key is a 400 validation error', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1' });
    expect(res.status).toBe(400);
  });

  test('B08-052 an export progresses REQUESTED -> GENERATING -> READY, and the file becomes downloadable', async () => {
    const e = await claimAndGenerateOne(claimKey('lifecycle'), {});
    const res = await workbookOf(e.exportId, admin);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('B08-053 an unknown export id is a 404 on status and download', async () => {
    const id = F.hex().slice(0, 36);
    expect((await get(`/research-exports/${id}`, admin)).status).toBe(404);
    expect((await download(id, admin)).status).toBe(404);
  });
});

describe('research export request validation (B08-025, B08-026, B08-027, B08-054, B08-083)', () => {
  test('B08-025 a well-formed but unknown source question set is a 422 (a genuinely missing field is a 400 schema error, covered by contract tests)', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).set('Idempotency-Key', claimKey('req'))
      .send({ sourceAssessmentVersionId: '00000000-0000-4000-8000-000000000000', anonymisationVersion: 'fx-anon-v1' });
    expect(res.status).toBe(422);
  });

  test('B08-026 an unknown filter key is a 422 EXPORT_FILTER_UNKNOWN', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).set('Idempotency-Key', claimKey('fkey')).send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1', filters: { bogus: 'x' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EXPORT_FILTER_UNKNOWN');
  });

  test('B08-027 an invalid filter value is a 422', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).set('Idempotency-Key', claimKey('fval')).send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1', filters: { participantStatus: 'BANANA' } });
    expect(res.status).toBe(422);
  });

  test('B08-054 a suspended admin cannot request an export (403)', async () => {
    const away = await f.admin('SUSPENDED');
    const res = await claim(away, claimKey('suspended'), {});
    expect(res.status).toBe(403);
  });

  test('B08-083 downloading a FAILED export is a 422 INVALID_STATE', async () => {
    const e = await claim(admin, claimKey('fail'), {});
    exportIds.push(e.body.exportId);
    const spy = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full'); });
    const failed = await claimAndGenerate(e.body.exportId);
    spy.mockRestore();
    expect(failed.status).toBe('FAILED');
    expect(fs.existsSync(path.join(EXPORT_DIR, `${e.body.exportId}.xlsx`))).toBe(false);
    const s = (await get(`/research-exports/${e.body.exportId}`, admin)).body;
    expect(s.status).toBe('FAILED');
    // a plain JSON-aware request here, not the byte-buffering download() helper: this response is the error body, not a file
    const res = await get(`/research-exports/${e.body.exportId}/download`, admin);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  test('B08-034 a failed generation leaves no file and a fresh key still works afterwards', async () => {
    const failed = await claim(admin, claimKey('fail2'), {});
    exportIds.push(failed.body.exportId);
    const spy = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('boom'); });
    const done = await claimAndGenerate(failed.body.exportId);
    spy.mockRestore();
    expect(done.status).toBe('FAILED');
    const leftovers = fs.existsSync(path.join(EXPORT_DIR, failed.body.exportId)) || fs.existsSync(path.join(EXPORT_DIR, `${failed.body.exportId}.xlsx`));
    expect(leftovers).toBe(false);
    const ok = await claimAndGenerateOne(claimKey('afresh'), {});
    expect(ok.status).toBe('READY');
  });
});

describe('research export workbook contents (AT-20, AT-21, AT-28, AT-30, B08-029..B08-033, B08-040, B08-055..B08-059)', () => {
  test('AT-28 + AT-21 + B08-040 the workbook reconciles with the partition plan: every sheet row count matches the database', async () => {
    const { e, wb } = await master();
    const exp = await expectedCounts();
    const sheets = {};
    for (const name of wb.SheetNames) sheets[name] = rowsOf(wb, name);
    expect(sheets.README).toBeGreaterThan(0);
    expect(sheets.DATA_DICTIONARY).toBeGreaterThan(0);
    expect(sheets.PARTICIPANTS).toBe(exp.participants);
    expect(sheets.ATTEMPTS).toBe(exp.attempts);
    expect(sheets.DOMAIN_SCORES).toBe(exp.scores);
    expect(sheets.QUALITY_FLAGS).toBe(exp.quality);
    expect(sheets.RESPONSE_EVENTS).toBe(exp.events);
    expect(sheets.ASSESSMENT_VERSION).toBe(1);
    expect(sheets.COHORT_METADATA).toBeGreaterThan(0);
    expect(itemResponsesOf(wb, 'ITEM_RESPONSES_01')).toHaveLength(sheets.ITEM_RESPONSES_01);
    // STN-outer: the number of answer rows equals the frozen attempt answer total in the database
    expect(sheets.ITEM_RESPONSES_01).toBe(exp.responses);
    // EXPORT_METADATA states what was written, per sheet, and the file agrees
    // EXPORT_METADATA cannot state its own row count (not known until it is written), so every OTHER sheet only
    for (const name of wb.SheetNames) { if (name === 'EXPORT_METADATA') continue; expect(metadataValue(wb, `rows_${name}`)).toBe(String(sheets[name])); }
    expect(metadataValue(wb, 'export_id')).toBe(e.exportId);
    expect(metadataValue(wb, 'withdrawn_participants_excluded')).toBe(String(exp.withdrawn));
  });

  test('B08-029 workbook sheet order matches the export contract', async () => {
    const { wb } = await master();
    expect(wb.SheetNames).toEqual(['README', 'DATA_DICTIONARY', 'PARTICIPANTS', 'ATTEMPTS', 'ITEM_RESPONSES_01', 'DOMAIN_SCORES', 'QUALITY_FLAGS', 'RESPONSE_EVENTS', 'ASSESSMENT_VERSION', 'COHORT_METADATA', 'EXPORT_METADATA']);
  });

  test('AT-30 + B08-030 no direct-identity column survives in any sheet, and the opaque Santulan ID is the only identifier', async () => {
    const { wb } = await master();
    for (const name of wb.SheetNames) {
      const header = (sheetOf(wb, name) || [])[0] || []; // the raw sheet's first row (dataRows already strips it)
      for (const cell of header) expect(FORBIDDEN_COLUMNS.has(String(cell).toLowerCase())).toBe(false);
    }
    const participantsPrefix = dataRows(sheetOf(wb, 'PARTICIPANTS')).map((r) => String(r[0]));
    expect(participantsPrefix.length).toBeGreaterThan(0);
    expect(participantsPrefix.every((id) => id.startsWith('STN-'))).toBe(true);
    const attempts = dataRows(sheetOf(wb, 'ATTEMPTS'));
    for (const row of attempts) expect(String(row[1])).toMatch(/^STN-/); // santulan_id column (0 = attempt_id, 1 = santulan_id)
  });

  test('B08-055 ITEM_RESPONSES carries the contract headers and no item text or direct identity', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'ITEM_RESPONSES_01') || [])[0];
    expect(header).toEqual(Object.keys(RULES_SHEETS.ITEM_RESPONSES.columns));
    expect(header).not.toContain('item_text');
    expect(header).not.toContain('participant_id');
    const rows = dataRows(sheetOf(wb, 'ITEM_RESPONSES_01'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Number(row[4])).toBeGreaterThan(0); // response_value position (0=response_id,1=attempt_id,2=santulan_id,3=item_code,4=response_value)
      expect(String(row[3])).toMatch(/^C\d-0\d$/); // item_code
    }
  });

  test('B08-031 DOMAIN_SCORES carries the contract headers and one row per scored domain', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'DOMAIN_SCORES') || [])[0];
    expect(header).toEqual(Object.keys(RULES_SHEETS.DOMAIN_SCORES.columns));
    const rows = dataRows(sheetOf(wb, 'DOMAIN_SCORES'));
    expect(rows).toHaveLength(await expectedCounts().then((e) => e.scores));
    const domains = new Set(rows.map((r) => r[2]));
    expect([...domains].sort()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
  });

  test('B08-032 QUALITY_FLAGS carries its flags and never the Q09 code', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'QUALITY_FLAGS') || [])[0];
    expect(header).toEqual(Object.keys(RULES_SHEETS.QUALITY_FLAGS.columns));
    const codes = dataRows(sheetOf(wb, 'QUALITY_FLAGS')).map((r) => String(r[3]));
    expect(codes).toContain('Q03');
    expect(codes).toContain('Q07');
    expect(codes).not.toContain('Q09');
  });

  test('B08-033 formula-lookalike text is written inert, never executed', async () => {
    const { wb } = await master();
    const cells = wb.SheetNames.flatMap((name) => dataRows(sheetOf(wb, name)).flatMap((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))));
    const hit = cells.find((c) => c.replace(/^'/, '') === '=EVAL(0)');
    expect(hit).toBeDefined();
    expect(hit.startsWith("'")).toBe(true); // the escape is what keeps the cell inert
    const plus = cells.find((c) => c.replace(/^'/, '') === '+CMD(1)');
    expect(plus).toBeDefined();
    expect(plus.startsWith("'")).toBe(true);
    expect(cells.some((c) => c.startsWith('=') && !c.startsWith("'"))).toBe(false);
  });

  test('B08-071 oversized metadata is truncated with the truncation marker', async () => {
    const { wb } = await master();
    const metaCells = dataRows(sheetOf(wb, 'RESPONSE_EVENTS')).map((r) => String(r[6] || '')).filter((c) => c.length > 1000);
    expect(metaCells.length).toBeGreaterThan(0);
    for (const cell of metaCells) {
      expect(cell.length).toBeGreaterThanOrEqual(32000);
      expect(cell.endsWith(TRUNCATION_MARKER)).toBe(true);
      expect(cell.length).toBeLessThanOrEqual(32000 + TRUNCATION_MARKER.length + 8);
    }
  });

  test('B08-056 + B08-057 the current-only dataset is the baseline and metadata is present for every sheet', async () => {
    const { wb } = await master();
    const meta = metadataRows(wb);
    // EXPORT_METADATA cannot state its own row count (the count isn't known until it is written), so every OTHER sheet only
    for (const name of wb.SheetNames) { if (name === 'EXPORT_METADATA') continue; expect(meta.some((r) => r[0] === `rows_${name}`)).toBe(true); }
    expect(metadataValue(wb, 'dataset')).toBe('current-only');
    expect(metadataValue(wb, 'include_all_versions')).toBe('false');
  });

  test('B08-058 the all-versions dataset adds exactly the superseded answers and nothing else', async () => {
    const { e, wb } = await master();
    const { wb: aWb } = await filtered('allv', { includeAllVersions: true });
    const all = itemResponseRows(aWb);
    const current = itemResponseRows(wb);
    const expectedAll = await expectedCounts({ allVersions: true });
    expect(all).toBe(expectedAll.responses);
    expect(all - current).toBe(14); // the superseded v1 responses of one B attempt
    expect(metadataValue(aWb, 'dataset')).toBe('all-versions');
    expect(metadataValue(aWb, 'include_all_versions')).toBe('true');
    expect(e.exportId).toBeDefined();
  });
});

describe('research export filters (B08-065, B08-066, B08-067, B08-082, AT-20)', () => {
  test('AT-20 + B08-066 the institution filter limits every data sheet to that institution', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('instA', { filters: { institutionId: z.instA } });
    const exp = await expectedCounts({ institutionId: z.instA });
    expect(exp.participants).toBe(7); // A1..A7 (withdrawn A-people are excluded by the policy, not the filter)
    expect(rowsOf(wb, 'ATTEMPTS')).toBe(exp.attempts);
    expect(rowsOf(wb, 'ITEM_RESPONSES_01')).toBe(exp.responses);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    const allCells = [...wb.SheetNames].filter((n) => !['README', 'DATA_DICTIONARY', 'EXPORT_METADATA', 'ASSESSMENT_VERSION'].includes(n))
      .flatMap((n) => dataRows(sheetOf(wb, n)).flatMap((r) => r.map((c) => String(c))));
    expect(allCells.some((c) => c.startsWith('STN-') && c === global.T137_SCOPE.W.find((w) => w === c))).toBe(false);
  });

  test('B08-065 the cohort filter limits every sheet to that cohort', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('coh', { filters: { cohortId: z.cohA } });
    const exp = await expectedCounts({ cohortId: z.cohA });
    expect(exp.attempts).toBeGreaterThan(0);
    expect(rowsOf(wb, 'ATTEMPTS')).toBe(exp.attempts);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    expect(rowsOf(wb, 'ITEM_RESPONSES_01')).toBe(exp.responses);
    const bAttempts = await db.collection('assessment_attempts').find({ assessment_version_id: S.setId }).toArray();
    const bIds = new Set(bAttempts.filter((a) => global.T137_SCOPE.B.some((p) => p.participantId === a.participant_id)).map((a) => String(a._id)));
    const attemptCells = dataRows(sheetOf(wb, 'ATTEMPTS')).map((r) => String(r[0]));
    for (const id of attemptCells) expect(bIds.has(id)).toBe(false);
  });

  test('B08-067 participant-status ACTIVE excludes withdrawn participants everywhere', async () => {
    const { wb } = await filtered('active', { filters: { participantStatus: 'ACTIVE' } });
    const exp = await expectedCounts({ status: 'ACTIVE' });
    expect(exp.withdrawn).toBe(0);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    expect(rowsOf(wb, 'ATTEMPTS')).toBe(exp.attempts);
    const z = global.T137_SCOPE;
    const allCells = wb.SheetNames.flatMap((n) => dataRows(sheetOf(wb, n || 'README')).flatMap((r) => r.map((c) => String(c))));
    for (const w of z.W) expect(allCells).not.toContain(w);
  });

  test('B08-082 dateFrom/dateTo restrict response rows to attempts in the window', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('dates', { filters: { dateFrom: dated(7), dateTo: dated(0) } });
    const exp = await expectedCounts({ dateFrom: dated(7), dateTo: dated(0) });
    expect(rowsOf(wb, 'ATTEMPTS')).toBe(exp.attempts);
    expect(rowsOf(wb, 'ITEM_RESPONSES_01')).toBe(exp.responses);
    const attemptCells = dataRows(sheetOf(wb, 'ATTEMPTS')).map((r) => String(r[0]));
    expect(attemptCells).not.toContain(String(z.oldAttempt));
  });

  test('B08-075 + B08-059 the README ships with the workbook and downloads expose no export-directory path', async () => {
    const { e } = await master();
    const res = await workbookOf(e.exportId, admin);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    // the phrase lives in the sheet's own header cell (dataRows strips it), so read the raw sheet, header included
    const text = (sheetOf(wb, 'README') || []).flat().map(String).join(' ');
    expect(text.toLowerCase()).toContain('santulan research export');
    expect(text.toLowerCase()).toContain('opaque santulan id');
    const disposition = String(res.headers['content-disposition']);
    expect(disposition).toMatch(/santulan_research_export_\d{4}-\d{2}-\d{2}\.xlsx/);
    expect(disposition).not.toContain('santulan-export-t137');
    expect(Buffer.from(res.body).includes(Buffer.from(EXPORT_DIR))).toBe(false);
  });

  test('B08-070 a download records a RESEARCH_EXPORT_DOWNLOADED audit row', async () => {
    const { e } = await master();
    await workbookOf(e.exportId, admin);
    const n = await db.collection('audit_logs').countDocuments({ action_type: 'RESEARCH_EXPORT_DOWNLOADED', target_id: e.exportId });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('B08-037 a download fails closed when the audit precondition cannot be written', async () => {
    const { e } = await master();
    const spy = jest.spyOn(store, 'withScope').mockRejectedValueOnce(new Error('audit write refused'));
    const res = await download(e.exportId, admin);
    spy.mockRestore();
    expect(res.status).toBe(500);
    // no file content ever streamed: the response is the small JSON error body, never the xlsx bytes (no zip magic number)
    expect(Buffer.from(res.body).slice(0, 2).toString()).not.toBe('PK');
    expect(res.headers['content-type']).not.toContain('spreadsheetml');
  });
});