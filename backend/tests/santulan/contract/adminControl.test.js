/*
 * Admin control, institutions, participants, monitoring, quality review and audit log (B08-001, 002, 004, 016, 017, 020..023, 061..064;
 * AT-16, 17, 29) on MongoDB. Through the real app and the runtime credential on the SCRATCH database.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const P = require('../helpers/pipeline');
const { closeClient } = require('../../../src/models/db/client');

const api = () => request(app);
const as = (who, method, p, body) => api()[method](`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` }).send(body);
const get = (p, who) => api().get(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` });
const post = (p, who, body = {}) => as(who, 'post', p, body);
const patch = (p, who, body = {}) => as(who, 'patch', p, body);
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);

let admin;
let S;
beforeAll(async () => { admin = await f.admin(); S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1 }); });
afterAll(async () => {
  const db = await H.admin();
  await post('/admin/assessment-control', admin, { state: 'OPEN', reason: 'test cleanup' });
  await db.collection('cohorts').deleteMany({ cohort_code: /^FX-/ });
  await db.collection('institutions').deleteMany({ institution_code: /^FX-/ });
  await db.collection('audit_logs').deleteMany({ action_type: { $regex: '^(INSTITUTION_|COHORT_|PARTICIPANT_SUSPENDED|PARTICIPANT_REACTIVATED|QUALITY_FLAG_REVIEWED|PARTICIPATION_CONTROL)' } });
  await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

/** An institutional participant of the institution / cohort (committed as the migrator). */
async function institutional(institutionId, cohortId, age = 16) {
  const p = await f.insert('participants', F.participant({
    santulan_id: f.fxSantulanId(), participation_route: 'INSTITUTIONAL', institution_id: institutionId, cohort_id: cohortId, external_student_id: `FX-EXT-${f.u()}`, age_years_at_registration: age,
  }));
  return { participantId: p._id, santulanId: p.santulan_id };
}

describe('access (B08-022, 023)', () => {
  test('participants, institution admins, suspended admins and anonymous callers are refused on every admin route', async () => {
    const participant = await f.participant(16);
    const inst = await f.admin('INACTIVE', 'INSTITUTION_ADMIN');
    const suspended = await f.admin('SUSPENDED');
    const routes = [['get', '/admin/assessment-control'], ['post', '/admin/assessment-control', { state: 'OPEN' }], ['get', '/admin/institutions'], ['post', '/admin/institutions', {}], ['get', '/admin/cohorts'],
      ['get', '/admin/participants'], ['get', '/admin/monitoring/summary'], ['get', '/admin/quality-flags'], ['get', '/admin/audit-logs'], ['get', '/research-exports']];
    for (const [method, path, body] of routes) {
      for (const who of [participant, inst, suspended]) expect({ path, method, status: (await as(who, method, path, body)).status }).toEqual({ path, method, status: 403 });
      expect((await api()[method](`/api/v1${path}`).send(body)).status).toBe(401);
    }
  });

  test('B08-008 an admin who is suspended loses access on the very next request', async () => {
    const temp = await f.admin();
    expect((await get('/admin/monitoring/summary', temp)).status).toBe(200);
    await (await H.admin()).collection('admin_users').updateOne({ _id: temp.adminUserId }, { $set: { status: 'SUSPENDED' } });
    expect((await get('/admin/monitoring/summary', temp)).status).toBe(403);
  });
});

describe('assessment control (AT-16, AT-17; B08-001, 002, 004)', () => {
  test('GET shows both gates: the control plane and the open question set per age group, with recent changes', async () => {
    const res = await get('/admin/assessment-control', admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ controlPlane: expect.stringMatching(/^(OPEN|STOPPED)$/), state: expect.any(String) });
    expect(res.body.openSets.map((s) => [s.setId, s.ageGroup])).toContainEqual([S.setId, 'ADOLESCENT']);
    expect(Array.isArray(res.body.recent)).toBe(true);
  });

  test('pause and stop need a reason (422), an unknown state is 400, OPEN does not need one; every change writes an audit row', async () => {
    for (const state of ['PAUSED', 'STOPPED']) {
      for (const body of [{ state }, { state, reason: '' }, { state, reason: 'ab' }]) expect((await post('/admin/assessment-control', admin, body)).status).toBe(422);
    }
    expect((await post('/admin/assessment-control', admin, { state: 'CLOSED', reason: 'reason' })).status).toBe(400);
    expect((await post('/admin/assessment-control', admin, { state: 'STOPPED', reason: 'reason', extra: 1 })).status).toBe(400);
    const before = await count('audit_logs', { action_type: 'PARTICIPATION_CONTROL' });
    expect((await post('/admin/assessment-control', admin, { state: 'PAUSED', reason: 'planned maintenance' })).status).toBe(200);
    expect((await post('/admin/assessment-control', admin, { state: 'OPEN' })).status).toBe(200);
    expect(await count('audit_logs', { action_type: 'PARTICIPATION_CONTROL' })).toBe(before + 2);
    const rows = await (await H.admin()).collection('audit_logs').find({ action_type: 'PARTICIPATION_CONTROL' }).sort({ occurred_at: -1 }).limit(2).toArray();
    expect(rows.map((r) => [r.new_state.state, r.previous_state.state, r.actor_id])).toEqual([['OPEN', 'PAUSED', admin.adminUserId], ['PAUSED', expect.any(String), admin.adminUserId]]);
    expect(rows[1].reason).toBe('planned maintenance');
  });

  test('stopping blocks NEW attempts without touching existing attempts or the frozen set; reopening restores eligibility', async () => {
    const running = await f.participant(15);
    const created = await post('/attempts', running, {});
    expect(created.status).toBe(201);
    const setBefore = await (await H.admin()).collection('assessment_versions').findOne({ _id: S.setId });
    const attemptBefore = await P.attemptOf(created.body.attemptId);

    expect((await post('/admin/assessment-control', admin, { state: 'STOPPED', reason: 'incident drill' })).status).toBe(200);
    const late = await f.participant(15);
    const refused = await post('/attempts', late, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
    expect(await count('assessment_attempts', { participant_id: late.participantId })).toBe(0);
    expect(await P.attemptOf(created.body.attemptId)).toEqual(attemptBefore); // the existing attempt is untouched
    expect(await (await H.admin()).collection('assessment_versions').findOne({ _id: S.setId })).toEqual(setBefore); // and so is the frozen set

    expect((await post('/admin/assessment-control', admin, { state: 'OPEN', reason: 'drill over' })).status).toBe(200);
    expect((await post('/attempts', late, {})).status).toBe(201);
  });
});

describe('institutions and cohorts (B08-016, 017, 020)', () => {
  test('create, update, archive; codes are unique; no delete route; an archived institution accepts no new cohort', async () => {
    const code = `FX-ADM-${f.u()}`;
    const made = await post('/admin/institutions', admin, { institutionCode: code, institutionName: 'Fixture School', institutionType: 'SCHOOL' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ institutionCode: code, institutionType: 'SCHOOL', status: 'ACTIVE', parentInstitutionId: null });
    const dup = await post('/admin/institutions', admin, { institutionCode: code, institutionName: 'Other', institutionType: 'COLLEGE' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_CODE');
    expect((await post('/admin/institutions', admin, { institutionCode: 'X', institutionName: 'Bad type', institutionType: 'ACADEMY' })).status).toBe(400);
    expect((await post('/admin/institutions', admin, { institutionCode: `FX-ADM-${f.u()}`, institutionName: 'Child', institutionType: 'COLLEGE', parentInstitutionId: made.body.institutionId })).status).toBe(201);

    const renamed = await patch(`/admin/institutions/${made.body.institutionId}`, admin, { institutionName: 'Fixture School (renamed)' });
    expect(renamed.body.institutionName).toBe('Fixture School (renamed)');
    expect((await patch(`/admin/institutions/${made.body.institutionId}`, admin, {})).status).toBe(400);
    expect((await patch(`/admin/institutions/${made.body.institutionId}`, admin, { institutionCode: 'NEW' })).status).toBe(400); // the code never changes

    const cohort = await post('/admin/cohorts', admin, { institutionId: made.body.institutionId, cohortCode: `FX-C-${f.u()}`, cohortName: 'Year 10', academicYear: '2026-27', developmentalBand: 'D2' });
    expect(cohort.status).toBe(201);
    expect((await get(`/admin/cohorts?institutionId=${made.body.institutionId}`, admin)).body.cohorts.map((c) => c.cohortId)).toEqual([cohort.body.cohortId]);
    expect((await patch(`/admin/cohorts/${cohort.body.cohortId}`, admin, { cohortName: 'Year 10 (A)' })).body.cohortName).toBe('Year 10 (A)');

    expect((await patch(`/admin/institutions/${made.body.institutionId}`, admin, { status: 'ARCHIVED' })).body.status).toBe('ARCHIVED');
    expect((await patch(`/admin/institutions/${made.body.institutionId}`, admin, { status: 'ACTIVE' })).status).toBe(422);
    const late = await post('/admin/cohorts', admin, { institutionId: made.body.institutionId, cohortCode: `FX-C-${f.u()}`, cohortName: 'Too late' });
    expect(late.status).toBe(422);
    expect((await api().delete(`/api/v1/admin/institutions/${made.body.institutionId}`).set({ Authorization: `Bearer ${admin.token}` })).status).toBe(404);
    expect(await count('institutions', { _id: made.body.institutionId })).toBe(1);
    const listed = (await get('/admin/institutions', admin)).body.institutions.find((i) => i.institutionId === made.body.institutionId);
    expect(listed.cohorts).toHaveLength(1);
    expect(await count('audit_logs', { target_id: made.body.institutionId, action_type: { $in: ['INSTITUTION_CREATED', 'INSTITUTION_UPDATED', 'INSTITUTION_ARCHIVED'] } })).toBe(3);
  });

  test('an unknown institution or cohort is 404 (or 422 when referenced); malformed ids are 404', async () => {
    expect((await patch('/admin/institutions/not-a-uuid', admin, { institutionName: 'Name' })).status).toBe(404);
    expect((await patch('/admin/institutions/00000000-0000-4000-8000-000000000000', admin, { institutionName: 'Name' })).status).toBe(404);
    expect((await post('/admin/cohorts', admin, { institutionId: '00000000-0000-4000-8000-000000000000', cohortCode: 'FX-C-1', cohortName: 'X1' })).status).toBe(422);
    expect((await patch('/admin/cohorts/00000000-0000-4000-8000-000000000000', admin, { cohortName: 'Name' })).status).toBe(404);
  });
});

describe('participant listing and status (AT-29; B08-061..064)', () => {
  let instA; let instB; let cohA1; let cohA2; let cohB1; let pA1; let pA2; let pB1; let open;
  beforeAll(async () => {
    instA = await f.institution(); instB = await f.institution();
    cohA1 = await f.cohort(instA); cohA2 = await f.cohort(instA); cohB1 = await f.cohort(instB);
    pA1 = await institutional(instA, cohA1); pA2 = await institutional(instA, cohA2); pB1 = await institutional(instB, cohB1);
    open = await f.participant(16);
  });

  test('an institution filter returns only that institution\'s participants; the cohort filter is consistent; the opaque Santulan ID is what identifies them', async () => {
    const a = (await get(`/admin/participants?institutionId=${instA}`, admin)).body;
    expect(a.participants.map((p) => p.santulanId).sort()).toEqual([pA1.santulanId, pA2.santulanId].sort());
    expect(a.participants.every((p) => p.institutionId === instA && p.participationRoute === 'INSTITUTIONAL')).toBe(true);
    const c = (await get(`/admin/participants?institutionId=${instA}&cohortId=${cohA1}`, admin)).body;
    expect(c.participants.map((p) => p.santulanId)).toEqual([pA1.santulanId]);
    expect((await get(`/admin/participants?cohortId=${cohB1}`, admin)).body.participants.map((p) => p.santulanId)).toEqual([pB1.santulanId]);
    expect((await get(`/admin/participants?institutionId=${instA}&cohortId=${cohB1}`, admin)).body.participants).toEqual([]); // a cohort of another institution never leaks in
    expect((await get('/admin/participants?route=OPEN&status=ACTIVE', admin)).body.participants.map((p) => p.santulanId)).toContain(open.santulanId);
    const wire = JSON.stringify(a);
    expect(wire).not.toMatch(/external_student_id|externalStudentId|auth_provider|email|mobile|guardian|FX-EXT-/i);
  });

  test('AT-29 omitting every filter is documented global behaviour (all participants); an unknown filter key is 422 EXPORT_FILTER_UNKNOWN', async () => {
    const all = (await get('/admin/participants?limit=500', admin)).body;
    const ids = all.participants.map((p) => p.santulanId);
    for (const p of [pA1, pA2, pB1, open]) expect(ids).toContain(p.santulanId);
    expect(all.total).toBeGreaterThanOrEqual(4);
    for (const q of ['institution=x', 'name=bob', 'institutionId=' + instA + '&extra=1']) {
      const res = await get(`/admin/participants?${q}`, admin);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('EXPORT_FILTER_UNKNOWN');
    }
  });

  test('the Santulan ID search finds one participant by whole or partial id, and narrows with the other filters', async () => {
    const body = pA1.santulanId.slice(4); // the id without its STN- prefix
    const whole = (await get(`/admin/participants?search=${pA1.santulanId}`, admin)).body;
    expect(whole.participants.map((p) => p.santulanId)).toEqual([pA1.santulanId]);
    // a prefix, the bare body, and lower case all reach the same participant
    for (const q of [pA1.santulanId.slice(0, 12), body, pA1.santulanId.toLowerCase()]) {
      expect((await get(`/admin/participants?search=${encodeURIComponent(q)}`, admin)).body.participants.map((p) => p.santulanId)).toContain(pA1.santulanId);
    }
    // search AND institution must hold on the same participant: pA1 is in instA, so instB returns nothing
    expect((await get(`/admin/participants?search=${pA1.santulanId}&institutionId=${instB}`, admin)).body.participants).toEqual([]);
    // a regex metacharacter is refused rather than reaching the query
    for (const hostile of ['.*', 'STN-.*', '(a%2B)%2B$']) {
      const res = await get(`/admin/participants?search=${hostile}`, admin);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('suspend and reactivate need a reason; the suspended participant is refused on their very next request; both changes are audited', async () => {
    const who = await f.participant(16);
    for (const body of [{ status: 'SUSPENDED' }, { status: 'SUSPENDED', reason: 'ab' }, { status: 'WITHDRAWN', reason: 'not allowed' }, { status: 'SUSPENDED', reason: 'ok reason', extra: 1 }]) {
      expect((await post(`/admin/participants/${who.participantId}/status`, admin, body)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await get('/registration/state', who)).status).toBe(200);
    expect((await post(`/admin/participants/${who.participantId}/status`, admin, { status: 'SUSPENDED', reason: 'safeguarding review' })).body).toMatchObject({ status: 'SUSPENDED', santulanId: who.santulanId });
    expect((await get('/registration/state', who)).status).toBe(403);
    expect((await post(`/admin/participants/${who.participantId}/status`, admin, { status: 'SUSPENDED', reason: 'again' })).status).toBe(422); // already suspended
    expect((await post(`/admin/participants/${who.participantId}/status`, admin, { status: 'ACTIVE', reason: 'review closed' })).body.status).toBe('ACTIVE');
    expect((await get('/registration/state', who)).status).toBe(200);
    const audit = await (await H.admin()).collection('audit_logs').find({ target_id: who.participantId, action_type: { $in: ['PARTICIPANT_SUSPENDED', 'PARTICIPANT_REACTIVATED'] } }).sort({ occurred_at: 1 }).toArray();
    expect(audit.map((r) => [r.action_type, r.reason, r.actor_id])).toEqual([['PARTICIPANT_SUSPENDED', 'safeguarding review', admin.adminUserId], ['PARTICIPANT_REACTIVATED', 'review closed', admin.adminUserId]]);
    expect((await post('/admin/participants/00000000-0000-4000-8000-000000000000/status', admin, { status: 'ACTIVE', reason: 'reason' })).status).toBe(404);
  });
});

describe('monitoring summary is counts only (B08-061)', () => {
  test('participants by route / status / institution, attempts by state, reports by state and retry queue, exports by state, quality-review counts, both gates', async () => {
    const a = await P.scoredAttempt(S);
    await (await H.admin()).collection('quality_flags').insertOne(F.qualityFlag(a.attemptId, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null }));
    const res = await get('/admin/monitoring/summary', admin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['attempts', 'exports', 'participants', 'participation', 'qualityReview', 'reports']);
    expect(res.body.participants.total).toBeGreaterThan(0);
    expect(Object.keys(res.body.participants.byRoute).every((k) => ['OPEN', 'INSTITUTIONAL'].includes(k))).toBe(true);
    expect(res.body.attempts.byState.SCORED).toBeGreaterThanOrEqual(1);
    expect(res.body.reports).toEqual({ byState: expect.any(Object), retryQueue: expect.any(Number) });
    expect(res.body.qualityReview.unreviewed).toBeGreaterThanOrEqual(1);
    expect(res.body.participation).toMatchObject({ controlPlane: 'OPEN', openAgeGroups: expect.arrayContaining(['ADOLESCENT']) });
    const wire = JSON.stringify(res.body);
    expect(wire).not.toMatch(/Q09|CRITICAL|severity|flag_?code|raw_?score|score_?status|S[0-5]\b|band|percentile|santulan_?id|STN-/i); // counts only: no scores, labels or safeguarding detail
  });
});

describe('quality review (B08-063)', () => {
  test('the restricted view lists flags (Q09 detail only here); a review records disposition and note; the audit row has no note text; only real dispositions are accepted', async () => {
    const a = await P.submittedAttempt(S);
    const db = await H.admin();
    const flag = F.qualityFlag(a.attemptId, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null });
    await db.collection('quality_flags').insertOne(flag);
    const list = await get(`/admin/quality-flags?attemptId=${a.attemptId}`, admin);
    expect(list.status).toBe(200);
    expect(list.body.flags).toEqual([expect.objectContaining({ flagId: flag._id, flagCode: 'Q09', severity: 'CRITICAL', disposition: 'UNREVIEWED', santulanId: expect.stringMatching(/^STN-/) })]);
    expect((await get('/admin/quality-flags?colour=red', admin)).status).toBe(422);
    expect((await get('/admin/quality-flags?disposition=MAYBE', admin)).status).toBe(422);

    for (const body of [{ disposition: 'UNREVIEWED' }, { disposition: 'PENDING' }, {}, { disposition: 'DISMISSED', extra: 1 }]) expect((await patch(`/admin/quality-flags/${flag._id}`, admin, body)).status).toBe(400);
    const reviewed = await patch(`/admin/quality-flags/${flag._id}`, admin, { disposition: 'ESCALATED', note: 'sent to the designated safeguarding lead' });
    expect(reviewed.body).toMatchObject({ disposition: 'ESCALATED', reviewNote: 'sent to the designated safeguarding lead' });
    expect(await db.collection('quality_flags').findOne({ _id: flag._id })).toMatchObject({ disposition: 'ESCALATED', reviewed_by: admin.adminUserId, review_note: 'sent to the designated safeguarding lead' });
    const audit = await db.collection('audit_logs').findOne({ action_type: 'QUALITY_FLAG_REVIEWED', target_id: flag._id });
    expect(audit).toMatchObject({ previous_state: { disposition: 'UNREVIEWED' }, new_state: { disposition: 'ESCALATED' } });
    expect(JSON.stringify(audit)).not.toMatch(/safeguarding lead/);
    expect((await patch('/admin/quality-flags/00000000-0000-4000-8000-000000000000', admin, { disposition: 'DISMISSED' })).status).toBe(404);
    expect(await db.collection('quality_flags').findOne({ _id: flag._id })).toMatchObject({ flag_code: 'Q09', severity: 'CRITICAL' }); // detection facts never change
  });
});

describe('audit log viewer (B08-064)', () => {
  test('read-only, newest first, filters by actor / action / target / date; an unknown key is 422; there is no write route', async () => {
    await post('/admin/assessment-control', admin, { state: 'PAUSED', reason: 'audit viewer test' });
    await post('/admin/assessment-control', admin, { state: 'OPEN', reason: 'audit viewer done' });
    const res = await get(`/admin/audit-logs?actor=${admin.adminUserId}&action=PARTICIPATION_CONTROL&limit=2`, admin);
    expect(res.status).toBe(200);
    expect(res.body.auditLogs).toHaveLength(2);
    expect(res.body.auditLogs.map((r) => r.newState.state)).toEqual(['OPEN', 'PAUSED']);
    expect(res.body.auditLogs[0]).toMatchObject({ actorType: 'ADMIN', actorId: admin.adminUserId, actionType: 'PARTICIPATION_CONTROL', reason: 'audit viewer done' });
    expect(res.body.auditLogs[0].correlationId).toBeUndefined();
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/admin/audit-logs?action=PARTICIPATION_CONTROL&from=${today}&to=${today}`, admin)).body.auditLogs.length).toBeGreaterThanOrEqual(2);
    expect((await get('/admin/audit-logs?action=PARTICIPATION_CONTROL&from=2000-01-01&to=2000-01-02', admin)).body.auditLogs).toEqual([]);
    expect((await get('/admin/audit-logs?colour=red', admin)).status).toBe(422);
    expect((await get('/admin/audit-logs?from=yesterday', admin)).status).toBe(422);
    for (const method of ['post', 'put', 'patch', 'delete']) expect((await api()[method]('/api/v1/admin/audit-logs').set({ Authorization: `Bearer ${admin.token}` }).send({})).status).toBe(404);
  });
});
