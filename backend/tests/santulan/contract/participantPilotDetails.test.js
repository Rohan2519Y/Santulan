/*
 * "Santulan Pilot Study Details" PART A capture (ASSUMED addition, an explicit override of the approved profile
 * form's own "exclude full name/DOB/religion" list - see participantPilotDetailsRules.js). Through the real app and
 * the runtime credential on the SCRATCH database.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/models/db/client');

const api = () => request(app);
const post = (p, who, body) => api().post(`/api/v1${p}`).set(who ? { Authorization: `Bearer ${who.token}` } : {}).send(body || {});
const get = (p, who) => api().get(`/api/v1${p}`).set(who ? { Authorization: `Bearer ${who.token}` } : {});
const identification = (overrides = {}) => ({
  fullName: 'A. Sharma', dateOfBirth: '2010-03-14', className: 'Grade 10', gender: 'Female', ...overrides,
});

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('submitting pilot study details', () => {
  test('a full submission is stored, read back, and is audited', async () => {
    const p = await f.participant(16);
    const before = await get('/participants/pilot-details', p);
    expect(before.status).toBe(404);

    const res = await post('/participants/pilot-details', p, {
      fullName: 'A. Sharma', dateOfBirth: '2010-03-14', className: 'Grade 10', gender: 'Female',
      birthOrder: 'FIRST_BORN', siblingCount: 1, religion: 'HINDU', familyType: 'NUCLEAR',
      residenceType: 'URBAN', state: 'Maharashtra', schoolType: 'PRIVATE', studyMedium: 'ENGLISH',
      board: 'CBSE', academicStream: 'NOT_APPLICABLE',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      participantId: p.participantId, captureVersion: 'PILOT_STUDY_DETAILS_v1.0',
      fullName: 'A. Sharma', className: 'Grade 10', religion: 'HINDU', board: 'CBSE',
    });
    expect(res.body.familyType).toBe('NUCLEAR');

    const again = await get('/participants/pilot-details', p);
    expect(again.status).toBe(200);
    expect(again.body.detailsId).toBe(res.body.detailsId);

    const row = await (await f.db()).collection('audit_logs').findOne({ action_type: 'PARTICIPANT_PILOT_DETAILS_SUBMITTED', target_id: res.body.detailsId });
    expect(row).toMatchObject({ actor_type: 'PARTICIPANT', actor_id: p.participantId });
  });

  test('required identification is stored while optional background fields default to null', async () => {
    const p = await f.participant(18);
    const res = await post('/participants/pilot-details', p, identification({ fullName: 'Minimal Name' }));
    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe('Minimal Name');
    expect(res.body.dateOfBirth.slice(0, 10)).toBe('2010-03-14');
    expect(res.body.religion).toBeNull();
  });

  test('a second submission edits the details: a new row is stored (Tier A, never an in-place update), and reads return the latest', async () => {
    const p = await f.participant(15);
    const first = await post('/participants/pilot-details', p, identification({ fullName: 'First Name', religion: 'HINDU' }));
    expect(first.status).toBe(201);
    const second = await post('/participants/pilot-details', p, identification({ fullName: 'Updated Name', religion: 'MUSLIM' }));
    expect(second.status).toBe(201);
    expect(second.body.detailsId).not.toBe(first.body.detailsId);

    const rows = await (await f.db()).collection('participant_pilot_details').find({ participant_id: p.participantId }).toArray();
    expect(rows).toHaveLength(2); // the first row is retained, not overwritten
    expect(rows.find((r) => r._id === first.body.detailsId).full_name).toBe('First Name');

    const latest = await get('/participants/pilot-details', p);
    expect(latest.status).toBe(200);
    expect(latest.body.detailsId).toBe(second.body.detailsId);
    expect(latest.body.fullName).toBe('Updated Name');

    const edited = await (await f.db()).collection('audit_logs').findOne({ action_type: 'PARTICIPANT_PILOT_DETAILS_EDITED', target_id: second.body.detailsId });
    expect(edited).toMatchObject({ actor_type: 'PARTICIPANT', actor_id: p.participantId });
  });

  test('full name, date of birth, class and gender are all required', async () => {
    const p = await f.participant(19);
    for (const field of ['fullName', 'dateOfBirth', 'className', 'gender']) {
      const body = identification();
      delete body[field];
      expect((await post('/participants/pilot-details', p, body)).status).toBe(400);
    }
    expect((await post('/participants/pilot-details', p, identification({ fullName: '   ' }))).status).toBe(400);
    expect((await post('/participants/pilot-details', p, identification({ dateOfBirth: '2026-02-30' }))).status).toBe(400);
  });

  test('an unknown key and an invalid enum value are both 400', async () => {
    const p = await f.participant(17);
    expect((await post('/participants/pilot-details', p, identification({ notAField: true }))).status).toBe(400);
    const bad = await post('/participants/pilot-details', p, identification({ religion: 'NOT_A_REAL_VALUE' }));
    expect(bad.status).toBe(400);
  });

  test('no token is 401', async () => {
    expect((await post('/participants/pilot-details', null, { fullName: 'X' })).status).toBe(401);
    expect((await get('/participants/pilot-details', null)).status).toBe(401);
  });
});
