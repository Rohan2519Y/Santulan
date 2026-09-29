/*
 * Validation-profile capture (ASSUMED addition, Student Demographic & Research Profile Capture Form v1.0 - the
 * "full recommended set", first captured during registration and editable afterwards). Through the real app and the
 * runtime credential on the SCRATCH database.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/models/db/client');

const api = () => request(app);
const post = (p, who, body) => api().post(`/api/v1${p}`).set(who ? { Authorization: `Bearer ${who.token}` } : {}).send(body || {});
const get = (p, who) => api().get(`/api/v1${p}`).set(who ? { Authorization: `Bearer ${who.token}` } : {});

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('submitting a validation profile', () => {
  test('a full submission is stored, read back, marks registration/state.profileCompleted, and is audited', async () => {
    const p = await f.participant(16);
    const before = await get('/participants/profile', p);
    expect(before.status).toBe(404);

    const res = await post('/participants/profile', p, {
      educationStage: 'SCHOOL', currentClassYear: 'GRADE_10',
      primaryLanguageMode: 'DIFFERENT', primaryLanguageDetail: 'Marathi',
      mediumOfInstruction: 'ENGLISH',
      genderResearch: 'PREFER_NOT_TO_SAY',
      broadRegionMode: 'STATE_UT', broadRegionDetail: 'Maharashtra',
      urbanicity: 'URBAN',
      accessibilityAccommodation: 'NONE',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      participantId: p.participantId, profileVersion: 'STUDENT_PROFILE_v1.0',
      educationStage: 'SCHOOL', currentClassYear: 'GRADE_10', primaryLanguageDetail: 'Marathi', urbanicity: 'URBAN',
    });
    expect(res.body.mediumOfInstructionDetail).toBeNull(); // every declared field present, null when unanswered

    const again = await get('/participants/profile', p);
    expect(again.status).toBe(200);
    expect(again.body.profileId).toBe(res.body.profileId);

    const state = await get('/registration/state', p);
    expect(state.body.profileCompleted).toBe(true);

    const row = await (await f.db()).collection('audit_logs').findOne({ action_type: 'PARTICIPANT_PROFILE_SUBMITTED', target_id: res.body.profileId });
    expect(row).toMatchObject({ actor_type: 'PARTICIPANT', actor_id: p.participantId });
  });

  test('a second submission edits the profile: a new row is stored (Tier A, never an in-place update), and reads return the latest', async () => {
    const p = await f.participant(15);
    const first = await post('/participants/profile', p, { educationStage: 'SCHOOL', currentClassYear: 'GRADE_10' });
    expect(first.status).toBe(201);
    const second = await post('/participants/profile', p, { educationStage: 'UNDERGRADUATE', currentClassYear: 'UG_YEAR_1' });
    expect(second.status).toBe(201);
    expect(second.body.profileId).not.toBe(first.body.profileId);

    const rows = await (await f.db()).collection('participant_profiles').find({ participant_id: p.participantId }).toArray();
    expect(rows).toHaveLength(2); // the first row is retained, not overwritten
    expect(rows.find((r) => r._id === first.body.profileId).education_stage).toBe('SCHOOL');

    const latest = await get('/participants/profile', p);
    expect(latest.status).toBe(200);
    expect(latest.body.profileId).toBe(second.body.profileId);
    expect(latest.body.educationStage).toBe('UNDERGRADUATE');

    const edited = await (await f.db()).collection('audit_logs').findOne({ action_type: 'PARTICIPANT_PROFILE_EDITED', target_id: second.body.profileId });
    expect(edited).toMatchObject({ actor_type: 'PARTICIPANT', actor_id: p.participantId });
  });

  test('a class/year that does not belong to the chosen education stage is refused (422)', async () => {
    const p = await f.participant(20);
    const res = await post('/participants/profile', p, { educationStage: 'UNDERGRADUATE', currentClassYear: 'GRADE_10' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLASS_YEAR_INVALID_FOR_STAGE');
  });

  test('broad region and urbanicity are refused for an institutional participant (422 FIELD_NOT_APPLICABLE)', async () => {
    const inst = await f.institution();
    const coh = await f.cohort(inst);
    const doc = await f.insert('participants', F.participant({ participation_route: 'INSTITUTIONAL', institution_id: inst, cohort_id: coh, external_student_id: `FX-EXT-${f.u()}` }));
    const who = { token: f.participantToken(doc._id) };
    const res = await post('/participants/profile', who, { urbanicity: 'URBAN' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FIELD_NOT_APPLICABLE');
    expect(await (await f.db()).collection('participant_profiles').findOne({ participant_id: doc._id })).toBeNull();
  });

  test('an unknown key and an invalid enum value are both 400; a submission with nothing at all still succeeds', async () => {
    const p = await f.participant(17);
    expect((await post('/participants/profile', p, { fullName: 'nope' })).status).toBe(400);
    const bad = await post('/participants/profile', p, { genderResearch: 'NOT_A_REAL_VALUE' });
    expect(bad.status).toBe(400);
    const empty = await post('/participants/profile', p, {});
    expect(empty.status).toBe(201);
    expect(empty.body.educationStage).toBeNull();
  });

  test('no token is 401', async () => {
    expect((await post('/participants/profile', null, {})).status).toBe(401);
    expect((await get('/participants/profile', null)).status).toBe(401);
  });
});
