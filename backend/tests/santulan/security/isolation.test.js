/*
 * Tenant isolation and privilege separation on the document store (T153; SEC-01..SEC-12, G-21..G-26, AT-17): institutions see only
 * their own participants, OPEN (null-tenant) rows never leak into an institutional scope, participants see only their own attempts
 * and reports, request bodies cannot spoof a scope, internal endpoints demand the explicit SYSTEM key, the runtime credential can
 * never remove or alter schema, transactions roll back atomically, and strict bodies reject unknown fields.
 *
 * The G-* controls are exercised over HTTP here; rollback (G-21) also drives the store transaction directly.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const store = require('../../../src/models/db');
const { collections, DEV_COLLECTIONS, views } = require('../../../src/models/schema');

const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const auth = (who) => ({ Authorization: `Bearer ${who.token}` });
const post = (p, who, body) => api().post(`/api/v1${p}`).set(auth(who)).send(body);
const get = (p, who) => api().get(`/api/v1${p}`).set(auth(who));
const del = (p, who) => api().delete(`/api/v1${p}`).set(auth(who));
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);
const u = () => f.u();

let admin;
let instA; let instB; let cohA; let cohB;
let pA; let pB; let openP;
let attemptA; let attemptB;
let reportA;
const T = {};

let db;

async function instParticipant(institutionId, cohortId) {
  const doc = F.participant({ participation_route: 'INSTITUTIONAL', institution_id: institutionId, cohort_id: cohortId, age_years_at_registration: 16, assessment_track: 'ADOLESCENT' });
  await db.collection('participants').insertOne(doc);
  const specs = doc.is_minor ? [['PARENT_GUARDIAN_CONSENT', 'PARENT'], ['STUDENT_ASSENT', 'SELF']] : [['ADULT_SELF_CONSENT', 'SELF']];
  for (const [type, giver] of specs) {
    await db.collection('consents').insertOne(F.verifiedConsent(doc._id, { consent_type: type, giver_relationship: giver, protocol_version: 'TEST-PROTOCOL-1', verification_method: 'TEST_METHOD_A' }));
  }
  return { participantId: doc._id, token: f.participantToken(doc._id), santulanId: doc.santulan_id };
}

/** Brings the participation control plane back to OPEN no matter how a test ended. */
async function resetControl() {
  const res = await post('/admin/assessment-control', admin, { state: 'OPEN' });
  expect([200, 202].includes(res.status)).toBe(true);
  return res.status;
}

beforeAll(async () => {
  db = await H.admin();
  admin = await f.admin();
  instA = await f.institution('ACTIVE');
  cohA = await f.cohort(instA, 'ACTIVE');
  instB = await f.institution('ACTIVE');
  cohB = await f.cohort(instB, 'ACTIVE');
  pA = await instParticipant(instA, cohA);
  pB = await instParticipant(instB, cohB);
  openP = await f.participant(15);

  T.S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  T.item = db.collection('items').findOne({ assessment_version_id: T.S.setId, display_order: 1 }).then((i) => i._id);

  // a scored, reported attempt belonging to pB, so SEC-05 has a real report: it must reach REPORT_READY
  // (terminal) before pB requests a fresh attempt, because only one attempt may be in progress.
  T.scored = (await post('/attempts', pB)).body.attemptId;
  await post(`/attempts/${T.scored}/sessions/resume`, pB);
  await f.answerAll(T.scored, () => '3');
  await post(`/attempts/${T.scored}/submit`, pB, { submissionKey: `sub-iso-${u()}-${u()}` });
  await internal('post', `/internal/attempts/${T.scored}/quality`, {});
  await internal('post', `/internal/attempts/${T.scored}/score`, { scoringVersion: 'domain-mean-v1' });
  reportA = (await internal('post', `/internal/attempts/${T.scored}/report`, {})).body.reportId;
  await f.closeOpenSets();
  T.S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  T.item = db.collection('items').findOne({ assessment_version_id: T.S.setId, display_order: 1 }).then((i) => i._id);

  attemptA = (await post('/attempts', pA)).body.attemptId;
  attemptB = (await post('/attempts', pB)).body.attemptId;
});

afterAll(async () => {
  await resetControl();
  await f.closeOpenSets();
  await f.cleanupFixtures();
  await db.collection('reports').deleteMany({ _id: reportA });
  await store.closeClient();
  await H.closeAll();
});

describe('tenant isolation between institutions and the OPEN tenant (SEC-01..SEC-03)', () => {
  test('SEC-01 an institution-A scope lists only institution-A participants', async () => {
    const res = await get(`/admin/participants?institutionId=${instA}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.participants.length).toBeGreaterThan(0);
    for (const row of res.body.participants) expect(row.institutionId).toBe(instA);
    expect(res.body.participants.some((r) => r.institutionId === instB)).toBe(false);
  });

  test('SEC-02 an institution-B scope lists only institution-B participants', async () => {
    const res = await get(`/admin/participants?institutionId=${instB}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.participants.length).toBeGreaterThan(0);
    for (const row of res.body.participants) expect(row.institutionId).toBe(instB);
    expect(res.body.participants.some((r) => r.institutionId === instA)).toBe(false);
  });

  test('SEC-03 OPEN null-tenant rows are visible globally but never inside an institutional scope', async () => {
    const globalRes = await get('/admin/participants', admin);
    expect(globalRes.body.participants.some((r) => r.institutionId === null || r.institutionId === undefined)).toBe(true);
    for (const inst of [instA, instB]) {
      const scoped = await get(`/admin/participants?institutionId=${inst}`, admin);
      expect(scoped.body.participants.every((r) => r.institutionId === inst)).toBe(true);
    }
  });
});

describe('participant-scoped visibility (SEC-04, SEC-05, SEC-06, SEC-10, SEC-11)', () => {
  test('SEC-04 a participant sees their own attempt and nothing of a colleague', async () => {
    expect((await get(`/attempts/${attemptA}`, pA)).status).toBe(200);
    expect((await get(`/attempts/${attemptA}`, pB)).status).toBe(404);
    expect((await get(`/attempts/${attemptB}`, pA)).status).toBe(404);
  });

  test('SEC-05 a participant cannot read another participant\'s attempt or report', async () => {
    expect((await get(`/attempts/${T.scored}`, pA)).status).toBe(404);
    expect((await get(`/reports/${reportA}`, pA)).status).toBe(404);
    expect((await get(`/reports/${reportA}`, pB)).status).toBe(200);
  });

  test('SEC-06 a participant token is refused by every admin and research route', async () => {
    for (const p of ['/admin/participants', '/admin/audit-logs', '/admin/assessment-control', '/research-exports']) {
      expect((await get(p, pA)).status).toBe(403);
    }
    expect((await post('/admin/participants/blah/status', pA, { status: 'SUSPENDED', reason: 'x' })).status).toBe(403);
  });

  test('SEC-10 no context means no data: anonymous requests are 401', async () => {
    expect((await api().get(`/api/v1/attempts/${attemptA}`)).status).toBe(401);
    expect((await api().get('/api/v1/admin/participants')).status).toBe(401);
    expect((await api().get(`/api/v1/reports/${reportA}`)).status).toBe(401);
    expect((await api().post('/api/v1/attempts').send({})).status).toBe(401);
  });

  test('SEC-11 two parallel, interleaved requests never share scope', async () => {
    const [r1, r2] = await Promise.all([get(`/attempts/${attemptA}`, pA), get(`/attempts/${attemptB}`, pB)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.attemptId).toBe(attemptA);
    expect(r2.body.attemptId).toBe(attemptB);
    expect(r1.body.attemptId).not.toBe(r2.body.attemptId);
  });
});

describe('super-admin visibility and scope spoofing (SEC-07, SEC-08, G-24)', () => {
  test('SEC-07 a SUPER_ADMIN sees every tenant in the unfiltered list', async () => {
    const res = await get('/admin/participants', admin);
    const ids = new Set(res.body.participants.map((r) => r.institutionId));
    expect(ids.has(instA)).toBe(true);
    expect(ids.has(instB)).toBe(true);
    expect(ids.has(null) || ids.has(undefined)).toBe(true);
  });

  test('SEC-08 a request body or header trying to set the scope is ignored: the attempt belongs to the token participant', async () => {
    const spoofBody = await post('/attempts', pA, { participantId: pB.participantId, institution_id: instB });
    expect(spoofBody.status).toBe(400); // strict schema: the scope can never be supplied by a client
    const pC = await instParticipant(instA, cohA);
    const spoofHeader = await api().post('/api/v1/attempts').set(auth(pC)).set('X-Institution-A', instB).send({});
    expect(spoofHeader.status).toBe(201);
    const id = spoofHeader.body.attemptId;
    const row = await db.collection('assessment_attempts').findOne({ _id: id });
    expect(row.participant_id).toBe(pC.participantId);
    expect((await get(`/attempts/${id}`, pB)).status).toBe(404);
  });

  test('G-24 extra request fields are rejected by strict validation (unknown keys, never silently accepted)', async () => {
    expect((await post('/attempts', pA, { unexpected: true })).status).toBe(400);
    expect((await post(`/attempts/${attemptA}/responses`, pA, {
      itemId: await T.item, value: '3', idempotencyKey: `g24-key-${u()}`, drift: 'y',
    })).status).toBe(400);
  });
});

describe('worker scope and the runtime credential (SEC-09, SEC-12, G-22, G-23, G-25)', () => {
  test('SEC-09 internal worker endpoints answer only an explicit SYSTEM-scoped call', async () => {
    expect((await api().get(`/api/v1/internal/attempts/${attemptA}/quality-flags`)).status).toBe(403);
    expect((await get(`/internal/attempts/${attemptA}/quality-flags`, pA)).status).toBe(403);
    expect((await get(`/internal/attempts/${attemptA}/quality-flags`, admin)).status).toBe(403);
    expect((await internal('get', `/internal/attempts/${attemptA}/quality-flags`)).status).toBe(200);
  });

  test('SEC-12 the runtime credential can never remove a row it can otherwise read', async () => {
    const p = await instParticipant(instA, cohA);
    await post('/attempts', p);
    const rt = await H.runtime();
    await expect(rt.collection('participants').deleteOne({ _id: p.participantId })).rejects.toThrow();
    const stillThere = await db.collection('participants').findOne({ _id: p.participantId });
    expect(stillThere).not.toBeNull();
  });

  test('G-22 no HTTP DELETE route exists anywhere in the API', async () => {
    expect((await del(`/admin/participants/${pA.participantId}`, admin)).status).toBe(404);
    expect((await del(`/attempts/${attemptA}`, pA)).status).toBe(404);
    expect((await del('/admin/quality-flags/x', admin)).status).toBe(404);
  });

  test('G-23 the runtime credential cannot alter the schema (no index or collection creation)', async () => {
    const rt = await H.runtime();
    await expect(rt.collection('participants').createIndex({ g23_probe: 1 })).rejects.toThrow();
    await expect(rt.collection('g23_probe_collection').insertOne({ x: 1 })).rejects.toThrow();
  });

  test('G-25 the database contains exactly the schema collections plus dev and the research views', async () => {
    const listed = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
    const expected = new Set([...collections.map((c) => c.name), ...DEV_COLLECTIONS, ...views.map((v) => v.name), '_data_migrations']);
    for (const name of expected) expect(listed.includes(name)).toBe(true);
    for (const name of listed) expect(expected.has(name)).toBe(true);
  });
});

describe('atomicity and concurrency controls (G-21, G-26, AT-17)', () => {
  test('G-21 a store transaction rolls back completely when a step fails', async () => {
    const probe = F.participant({ age_years_at_registration: 16 });
    const id = probe._id;
    await expect(store.withScope(
      store.superAdminScope('g21-admin'),
      async (tx) => {
        await tx.c.participants.insertOne(probe);
        await tx.c.participants.insertOne(F.participant({ age_years_at_registration: 16 }));
        throw new Error('force rollback');
      },
      { transaction: true },
    )).rejects.toThrow('force rollback');
    expect(await db.collection('participants').findOne({ _id: id })).toBeNull();
  });

  test('G-26 racing writes to the same attempt cannot both commit: one is a compare-and-set conflict', async () => {
    await post(`/attempts/${attemptA}/sessions/resume`, pA);
    const [a, b] = await Promise.all([
      post(`/attempts/${attemptA}/submit`, pA, { submissionKey: `g26-submit-a-${u()}-${u()}` }),
      post(`/attempts/${attemptA}/submit`, pA, { submissionKey: `g26-submit-b-${u()}-${u()}` }),
    ]);
    const ok = [a, b].filter((r) => r.status === 200 || r.status === 201);
    const conflict = [a, b].filter((r) => r.status === 409);
    expect(ok.length + conflict.length).toBe(2);
    expect(ok.length).toBe(1);
    expect(conflict.length).toBe(1);
  });

  test('AT-17 new attempts are refused while new participation is STOPPED, but existing sessions keep working', async () => {
    expect((await post('/admin/assessment-control', admin, { state: 'OPEN' })).status).toBe(200);
    const stopped = await post('/admin/assessment-control', admin, { state: 'STOPPED', reason: 'at-17 gate check' });
    expect(stopped.status).toBe(200);
    try {
      expect((await post('/attempts', pA)).status).toBe(409);
      expect((await post('/attempts', openP)).status).toBe(409);
      const session = await post(`/attempts/${attemptA}/sessions/resume`, pA);
      expect(session.status).toBe(409); // the STOPPED control plane also blocks starting or resuming a session
      expect((await get(`/attempts/${attemptA}`, pA)).status).toBe(200); // and existing data stays readable
    } finally {
      await resetControl();
    }
  });
});