/*
 * Research export end to end (T137; AT-20, AT-21, AT-28, AT-30, B08-024..083): a populated scratch database is exported through the
 * real endpoints and the real worker (claimAndGenerate), and every sheet of the downloaded workbook is cross-checked against the
 * database it was written from. Generation runs to a scratch temp directory; downloads stream the file and never a path.
 *
 * Rebuilt to match "Santulan Pilot - Sample Validation Data After Assessment Submission v1.0" (docs/Santulan 2.0/Profile):
 * nine sheets (README, PARTICIPANTS, ITEM_RESPONSES_LONG_nn, QUALITY_REVIEW, ATTEMPT_SUMMARY, one VALIDATION_WIDE_<track>,
 * ITEM_CODEBOOK, RESEARCH_DASHBOARD), participants identified by participant_research_id (not santulan_id), and
 * ITEM_RESPONSES_LONG carrying an explicit row for every expected item - answered or missing.
 */
process.env.EXPORT_DIR = require('path').join(require('os').tmpdir(), `santulan-export-t137-${process.pid}`);

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const XLSX = require('xlsx');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { v4: uuidv4 } = require('uuid');
const { FORBIDDEN_COLUMNS, participantResearchId } = require('../../../src/services/research/researchIdentity');
const store = require('../../../src/models/db');
const { claimAndGenerate } = require('../../../src/services/research/exportService');

const EXPORT_DIR = process.env.EXPORT_DIR;
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const ITEMS_PER_SET = 14; // f.openSet({ perDomain: 2 }) below: 7 domains x 2
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

/** Creates an attempt through the endpoint (201) and answers every question. `answer` overrides which items are answered. */
async function attemptFor(p, answer = () => '3') {
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const id = created.body.attemptId;
  expect((await post(`/attempts/${id}/sessions/resume`, p)).status).toBe(200);
  await f.answerAll(id, answer);
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
const rowsOf = (wb, name) => dataRows(sheetOf(wb, name)).length;
const irSheetNames = (wb) => Object.keys(wb.Sheets).filter((n) => n.startsWith('ITEM_RESPONSES_LONG'));
const irRows = (wb) => irSheetNames(wb).reduce((sum, n) => sum + dataRows(sheetOf(wb, n)).length, 0);
const readmeText = (wb) => (sheetOf(wb, 'README') || []).flat().map((c) => (c === null ? '' : String(c))).join(' ');

/** Mirrors buildScope + the identity policy, plus the new attempt x item-catalog model, so workbook counts can be
 * compared with the database they came from. Every fixture attempt below is fully answered via f.answerAll, except
 * `partialAttempt` (deliberately created with some items skipped) - see beforeAll. */
async function expectedCounts({ institutionId, cohortId, status, dateFrom, dateTo } = {}) {
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
  const count = (coll, filter) => db.collection(coll).countDocuments(filter);
  const missing = await db.collection('responses').aggregate([
    { $match: { attempt_id: { $in: allowedAttempts.map((a) => a._id) }, is_current: true } },
    { $group: { _id: '$attempt_id', n: { $sum: 1 } } },
  ]).toArray();
  const answeredByAttempt = new Map(missing.map((m) => [String(m._id), m.n]));
  const totalMissing = allowedAttempts.reduce((sum, a) => sum + (ITEMS_PER_SET - (answeredByAttempt.get(String(a._id)) || 0)), 0);
  return {
    attempts: allowedAttempts.length, participants: allowed.length, withdrawn: people.length - allowed.length,
    itemResponseRows: allowedAttempts.length * ITEMS_PER_SET, // every expected item gets a row, answered or missing
    missingRows: totalMissing,
    quality: await count('quality_flags', { attempt_id: { $in: allowedAttempts.map((a) => a._id) }, flag_code: { $ne: 'Q09' } }),
  };
}

const dated = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString().slice(0, 10);

let partialAttempt; // deliberately answers only the first 5 of 14 items, to exercise missing-row synthesis
let partialParticipant;

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

  // text a spreadsheet could read as a formula: the export must escape it (B08-033). instA/cohA (not an unlinked
  // fixture institution) so the codes actually reach a real participant's exported rows - the new sheet set has no
  // standalone cohort-metadata sheet that would list an institution regardless of participant linkage.
  await db.collection('institutions').updateOne({ _id: instA }, { $set: { institution_code: '=EVAL(0)' } });
  await db.collection('cohorts').updateOne({ _id: cohA }, { $set: { cohort_code: '+CMD(1)' } });

  const oldA = await iPart({ institution_id: instA, cohort_id: cohA });
  const oldAttempt = await scoredAttempt(oldA);
  await db.collection('assessment_attempts').updateOne({ _id: oldAttempt }, { $set: { created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) } });
  await db.collection('responses').updateMany({ attempt_id: oldAttempt }, { $set: { answered_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) } });

  const A = [];
  for (let i = 0; i < 6; i += 1) { const p = await iPart({ institution_id: instA, cohort_id: cohA }); A.push(p); await scoredAttempt(p); }
  const B = [];
  for (let i = 0; i < 4; i += 1) { const p = await iPart({ institution_id: instB, cohort_id: cohB }); B.push(p); await scoredAttempt(p); }

  // version-2 supersession on the first B attempt: v1 stays in the archive, only v2 "counts" (is_current) - the
  // export always reads is_current, so this attempt still shows as fully answered with zero missing rows
  const bParts = await db.collection('assessment_attempts').find({ participant_id: B[0].participantId }, { projection: { _id: 1 } }).toArray();
  const bAttempt = bParts[0]._id;
  const oldDocs = await db.collection('responses').find({ attempt_id: bAttempt }).toArray();
  const replacements = oldDocs.map((r) => ({ ...r, _id: uuidv4(), response_version: 2, is_current: true, supersedes_response_id: r._id, idempotency_key: `fx-v2-${u()}` }));
  await db.collection('responses').updateMany({ attempt_id: bAttempt }, { $set: { is_current: false } });
  await db.collection('responses').insertMany(replacements);

  // one OPEN, never-submitted attempt with quality flags (Q03 + Q07)
  const openP = await iPart({ institution_id: instB, cohort_id: cohB });
  const openAttempt = await attemptFor(openP);
  await db.collection('quality_flags').insertMany([
    F.qualityFlag(openAttempt, { flag_code: 'Q03', severity: 'MEDIUM', disposition: 'UNREVIEWED' }),
    F.qualityFlag(openAttempt, { flag_code: 'Q07', severity: 'LOW', disposition: 'UNREVIEWED' }),
  ]);

  // deliberately partial: answers only the first 5 of 14 items, to exercise ITEM_RESPONSES_LONG's missing rows and
  // ATTEMPT_SUMMARY's completion/capture-class/readiness classification
  partialParticipant = await iPart({ institution_id: instA, cohort_id: cohA });
  partialAttempt = await attemptFor(partialParticipant, ({ order }) => (order <= 5 ? '3' : null));

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
    const key = claimKey('once');
    const [a, b] = await Promise.all([claim(admin, key, {}), claim(admin, key, {})]);
    const ok = [a, b].filter((r) => r.status === 202);
    const dup = [a, b].filter((r) => r.status !== 202);
    expect(ok).toHaveLength(1);
    expect(dup).toHaveLength(1);
    expect(dup[0].status).toBe(200);
    expect(dup[0].body.exportId).toBe(ok[0].body.exportId);
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

  test('B08-026b includeAllVersions is no longer a request field - it is refused as an unknown key, not silently accepted', async () => {
    const res = await api().post('/api/v1/research-exports').set(auth(admin)).set('Idempotency-Key', claimKey('iav')).send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1', includeAllVersions: true });
    expect(res.status).toBe(400); // top-level strictObject: unrecognised key
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
    const res = await get(`/research-exports/${e.body.exportId}/download`, admin);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  test('B08-034 a failed generation leaves no file and a fresh key still works afterwards', async () => {
    const failedReq = await claim(admin, claimKey('fail2'), {});
    exportIds.push(failedReq.body.exportId);
    const spy = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('boom'); });
    const done = await claimAndGenerate(failedReq.body.exportId);
    spy.mockRestore();
    expect(done.status).toBe('FAILED');
    const leftovers = fs.existsSync(path.join(EXPORT_DIR, failedReq.body.exportId)) || fs.existsSync(path.join(EXPORT_DIR, `${failedReq.body.exportId}.xlsx`));
    expect(leftovers).toBe(false);
    const ok = await claimAndGenerateOne(claimKey('afresh'), {});
    expect(ok.status).toBe('READY');
  });
});

describe('research export workbook contents (AT-20, AT-21, AT-28, AT-30, B08-029..B08-033, B08-055..B08-059)', () => {
  test('the workbook has exactly the nine sheets of the sample format, in order (ADOLESCENT track: VALIDATION_WIDE_ADO only)', async () => {
    const { wb } = await master();
    expect(wb.SheetNames).toEqual(['README', 'PARTICIPANTS', 'ITEM_RESPONSES_LONG_01', 'ATTEMPT_SUMMARY', 'QUALITY_REVIEW', 'VALIDATION_WIDE_ADO', 'ITEM_CODEBOOK', 'RESEARCH_DASHBOARD']);
  });

  test('AT-28 + AT-21 every sheet row count matches the database it was written from, including synthesised missing rows', async () => {
    const { wb } = await master();
    const exp = await expectedCounts();
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    expect(rowsOf(wb, 'ATTEMPT_SUMMARY')).toBe(exp.attempts);
    expect(rowsOf(wb, 'VALIDATION_WIDE_ADO')).toBe(exp.attempts);
    expect(rowsOf(wb, 'QUALITY_REVIEW')).toBe(exp.quality);
    expect(rowsOf(wb, 'ITEM_CODEBOOK')).toBeGreaterThan(0);
    expect(irRows(wb)).toBe(exp.itemResponseRows);
  });

  test('AT-30 + B08-030 no direct-identity column survives in any sheet, and participant_research_id is the only identifier', async () => {
    const { wb } = await master();
    for (const name of wb.SheetNames) {
      const header = (sheetOf(wb, name) || [])[0] || [];
      for (const cell of header) expect(FORBIDDEN_COLUMNS.has(String(cell).toLowerCase())).toBe(false);
      expect(header).not.toContain('santulan_id');
    }
    const participantIds = dataRows(sheetOf(wb, 'PARTICIPANTS')).map((r) => String(r[0]));
    expect(participantIds.length).toBeGreaterThan(0);
    expect(participantIds.every((id) => /^PR-\d{6}$/.test(id))).toBe(true);
    // the pseudonym is stable and deterministic: recomputing it from the fixture's own santulan_id matches the file
    const p = global.T137_SCOPE.A[0];
    expect(participantIds).toContain(participantResearchId(p.santulanId));
  });

  test('ITEM_RESPONSES_LONG carries domain/subdomain context, an explicit missing row per unanswered item, and no item text or direct identity', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'ITEM_RESPONSES_LONG_01') || [])[0];
    expect(header).toEqual(['research_record_id', 'participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'item_code', 'domain_code', 'subdomain_code', 'response_value', 'missing_flag', 'response_version', 'is_current', 'response_timestamp', 'time_spent_ms']);
    expect(header).not.toContain('item_text');
    expect(header).not.toContain('participant_id');

    const rows = dataRows(sheetOf(wb, 'ITEM_RESPONSES_LONG_01'));
    const partialRows = rows.filter((r) => String(r[2]) === String(partialAttempt));
    expect(partialRows).toHaveLength(ITEMS_PER_SET); // one row per expected item, answered or missing
    expect(partialRows.filter((r) => r[9] === 'YES')).toHaveLength(ITEMS_PER_SET - 5); // 5 answered, 9 missing
    expect(partialRows.filter((r) => r[9] === 'NO')).toHaveLength(5);
    for (const r of partialRows.filter((r2) => r2[9] === 'NO')) expect(Number(r[8])).toBeGreaterThan(0); // response_value on an answered row
    for (const r of partialRows.filter((r2) => r2[9] === 'YES')) expect(r[8]).toBeNull(); // no response_value on a missing row
  });

  test('ATTEMPT_SUMMARY classifies completion the same way domain-level scoring already does, and derives validation_data_status', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'ATTEMPT_SUMMARY') || [])[0];
    expect(header).toEqual(['participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'age_years_at_attempt', 'developmental_band', 'attempt_status', 'total_items_expected', 'total_items_answered', 'completion_pct', 'missing_item_count', 'capture_class', 'quality_flag_count', 'validation_data_status', 'submitted_at']);
    const rows = dataRows(sheetOf(wb, 'ATTEMPT_SUMMARY'));
    const partialRow = rows.find((r) => String(r[1]) === String(partialAttempt));
    expect(partialRow).toBeDefined();
    expect(partialRow[5]).toBe('D2'); // developmental_band - partialParticipant is registered at age 16 (registrationRules: <=17 -> D2); must not be blank
    expect(Number(partialRow[7])).toBe(ITEMS_PER_SET); // total_items_expected
    expect(Number(partialRow[8])).toBe(5); // total_items_answered
    expect(Number(partialRow[10])).toBe(ITEMS_PER_SET - 5); // missing_item_count
    expect(partialRow[11]).toBe('INSUFFICIENT'); // 5/14 = 35.7%, at or below the 60% boundary (scoringRules.completenessStatus)
    expect(partialRow[13]).toBe('NOT_READY');

    const fullyAnswered = rows.find((r) => Number(r[8]) === ITEMS_PER_SET && r[11] === 'COMPLETE');
    expect(fullyAnswered).toBeDefined();
  });

  test('QUALITY_REVIEW carries its flags and never the Q09 code', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'QUALITY_REVIEW') || [])[0];
    expect(header).toEqual(['flag_id', 'participant_research_id', 'attempt_id', 'flag_code', 'domain_code', 'severity', 'disposition', 'detected_at', 'reviewed_at']);
    const codes = dataRows(sheetOf(wb, 'QUALITY_REVIEW')).map((r) => String(r[3]));
    expect(codes).toContain('Q03');
    expect(codes).toContain('Q07');
    expect(codes).not.toContain('Q09');
  });

  test('VALIDATION_WIDE_ADO has one column per expected item and no score columns; a missing item is a blank cell', async () => {
    const { wb } = await master();
    const header = (sheetOf(wb, 'VALIDATION_WIDE_ADO') || [])[0];
    expect(header.slice(0, 8)).toEqual(['participant_research_id', 'attempt_id', 'institution_code', 'cohort_code', 'age_years', 'developmental_band', 'assessment_form', 'assessment_version']);
    expect(header.length - 8).toBe(ITEMS_PER_SET);
    const rows = dataRows(sheetOf(wb, 'VALIDATION_WIDE_ADO'));
    const partialRow = rows.find((r) => String(r[1]) === String(partialAttempt));
    expect(partialRow[5]).toBe('D2'); // developmental_band - must not be blank
    const itemCells = partialRow.slice(8);
    expect(itemCells.filter((c) => c !== null && c !== '')).toHaveLength(5);
  });

  test('B08-033 formula-lookalike text is written inert, never executed', async () => {
    const { wb } = await master();
    const cells = wb.SheetNames.flatMap((name) => dataRows(sheetOf(wb, name)).flatMap((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))));
    const hit = cells.find((c) => c.replace(/^'/, '') === '=EVAL(0)');
    expect(hit).toBeDefined();
    expect(hit.startsWith("'")).toBe(true);
    const plus = cells.find((c) => c.replace(/^'/, '') === '+CMD(1)');
    expect(plus).toBeDefined();
    expect(plus.startsWith("'")).toBe(true);
    expect(cells.some((c) => c.startsWith('=') && !c.startsWith("'"))).toBe(false);
  });

  test('B08-075 + B08-059 the README ships with the workbook, names the export, and downloads expose no export-directory path', async () => {
    const { e } = await master();
    const res = await workbookOf(e.exportId, admin);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    const text = readmeText(wb).toLowerCase();
    expect(text).toContain('santulan research export');
    expect(text).toContain('participant_research_id');
    expect(text).toContain(e.exportId.toLowerCase());
    const disposition = String(res.headers['content-disposition']);
    expect(disposition).toMatch(/santulan_research_export_\d{4}-\d{2}-\d{2}\.xlsx/);
    expect(disposition).not.toContain('santulan-export-t137');
    expect(Buffer.from(res.body).includes(Buffer.from(EXPORT_DIR))).toBe(false);
  });
});

describe('research export filters (B08-065, B08-066, B08-067, B08-082, AT-20)', () => {
  test('AT-20 + B08-066 the institution filter limits every data sheet to that institution', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('instA', { filters: { institutionId: z.instA } });
    const exp = await expectedCounts({ institutionId: z.instA });
    expect(exp.participants).toBe(8); // A1..A7 + the partial-answer participant (withdrawn A-people excluded by the policy, not the filter)
    expect(rowsOf(wb, 'ATTEMPT_SUMMARY')).toBe(exp.attempts);
    expect(irRows(wb)).toBe(exp.itemResponseRows);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    const allCells = wb.SheetNames.filter((n) => n !== 'README')
      .flatMap((n) => dataRows(sheetOf(wb, n)).flatMap((r) => r.map((c) => String(c))));
    expect(allCells.some((c) => z.W.some((w) => participantResearchId(w) === c))).toBe(false);
  });

  test('B08-065 the cohort filter limits every sheet to that cohort', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('coh', { filters: { cohortId: z.cohA } });
    const exp = await expectedCounts({ cohortId: z.cohA });
    expect(exp.attempts).toBeGreaterThan(0);
    expect(rowsOf(wb, 'ATTEMPT_SUMMARY')).toBe(exp.attempts);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    expect(irRows(wb)).toBe(exp.itemResponseRows);
    const bAttempts = await db.collection('assessment_attempts').find({ assessment_version_id: S.setId }).toArray();
    const bIds = new Set(bAttempts.filter((a) => z.B.some((p) => p.participantId === a.participant_id)).map((a) => String(a._id)));
    const attemptCells = dataRows(sheetOf(wb, 'ATTEMPT_SUMMARY')).map((r) => String(r[1]));
    for (const id of attemptCells) expect(bIds.has(id)).toBe(false);
  });

  test('B08-067 participant-status ACTIVE excludes withdrawn participants everywhere', async () => {
    const { wb } = await filtered('active', { filters: { participantStatus: 'ACTIVE' } });
    const exp = await expectedCounts({ status: 'ACTIVE' });
    expect(exp.withdrawn).toBe(0);
    expect(rowsOf(wb, 'PARTICIPANTS')).toBe(exp.participants);
    expect(rowsOf(wb, 'ATTEMPT_SUMMARY')).toBe(exp.attempts);
    const z = global.T137_SCOPE;
    const allCells = wb.SheetNames.flatMap((n) => dataRows(sheetOf(wb, n)).flatMap((r) => r.map((c) => String(c))));
    for (const w of z.W) expect(allCells).not.toContain(participantResearchId(w));
  });

  test('B08-082 dateFrom/dateTo restrict attempt rows to the window', async () => {
    const z = global.T137_SCOPE;
    const { wb } = await filtered('dates', { filters: { dateFrom: dated(7), dateTo: dated(0) } });
    const exp = await expectedCounts({ dateFrom: dated(7), dateTo: dated(0) });
    expect(rowsOf(wb, 'ATTEMPT_SUMMARY')).toBe(exp.attempts);
    expect(irRows(wb)).toBe(exp.itemResponseRows);
    const attemptCells = dataRows(sheetOf(wb, 'ATTEMPT_SUMMARY')).map((r) => String(r[1]));
    expect(attemptCells).not.toContain(String(z.oldAttempt));
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
    expect(Buffer.from(res.body).slice(0, 2).toString()).not.toBe('PK');
    expect(res.headers['content-type']).not.toContain('spreadsheetml');
  });
});
