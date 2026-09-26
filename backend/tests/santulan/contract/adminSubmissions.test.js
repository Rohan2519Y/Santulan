/*
 * Admin submissions listing and its Santulan ID search (the ASSUMED read-only addition D-M19; contracts/api.md, "Additions
 * beyond this contract"). Through the real app and the runtime credential on the SCRATCH database.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/models/db/client');

const api = () => request(app);
const get = (p, who) => api().get(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` });
const idsOf = (body) => body.submissions.map((s) => s.santulanId);

let admin; let S; let inst; let coh; let mine; let other;

/** A participant (institutional when given a cohort) with one SUBMITTED attempt on the open set, committed as the migrator. */
async function submitted({ institutionId = null, cohortId = null, age = 15 } = {}) {
  const p = await f.insert('participants', F.participant({
    santulan_id: f.fxSantulanId(),
    age_years_at_registration: age,
    ...(institutionId ? { participation_route: 'INSTITUTIONAL', institution_id: institutionId, cohort_id: cohortId, external_student_id: `FX-EXT-${f.u()}` } : {}),
  }));
  const a = await f.insert('assessment_attempts', F.attempt(p._id, S.setId, {
    status: 'SUBMITTED', session_count: 1, age_years_at_attempt: age, developmental_band_at_attempt: F.bandOf(age),
    started_at: new Date(), submitted_at: new Date(), last_activity_at: new Date(),
  }));
  return { santulanId: p.santulan_id, attemptId: a._id, participantId: p._id };
}

beforeAll(async () => {
  admin = await f.admin();
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1 });
  inst = await f.institution();
  coh = await f.cohort(inst);
  mine = await submitted({ institutionId: inst, cohortId: coh });
  other = await submitted();
});

afterAll(async () => {
  const db = await H.admin();
  await db.collection('cohorts').deleteMany({ cohort_code: /^FX-/ });
  await db.collection('institutions').deleteMany({ institution_code: /^FX-/ });
  await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

describe('the submissions listing', () => {
  test('lists attempts by opaque Santulan ID, with no participant identity beyond it', async () => {
    const res = await get('/admin/submissions?limit=500', admin);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([mine.santulanId, other.santulanId]));
    const row = res.body.submissions.find((s) => s.santulanId === mine.santulanId);
    expect(row).toMatchObject({ attemptId: mine.attemptId, status: 'SUBMITTED', institutionId: inst, cohortId: coh });
    expect(JSON.stringify(res.body)).not.toMatch(/external_student_id|externalStudentId|auth_provider|FX-EXT-/i);
  });

  test('an unknown filter key is refused rather than ignored', async () => {
    const res = await get('/admin/submissions?name=bob', admin);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EXPORT_FILTER_UNKNOWN');
  });
});

describe('the Santulan ID search', () => {
  test('finds one submission by the whole id, a prefix, the bare body or lower case', async () => {
    for (const q of [mine.santulanId, mine.santulanId.slice(0, 12), mine.santulanId.slice(4), mine.santulanId.toLowerCase()]) {
      const res = await get(`/admin/submissions?search=${encodeURIComponent(q)}`, admin);
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toContain(mine.santulanId);
    }
    expect(idsOf((await get(`/admin/submissions?search=${mine.santulanId}`, admin)).body)).toEqual([mine.santulanId]);
  });

  test('search intersects with the other filters instead of replacing them', async () => {
    // `other` has no institution, so pairing its id with this institution must match nothing
    expect((await get(`/admin/submissions?search=${other.santulanId}&institutionId=${inst}`, admin)).body.submissions).toEqual([]);
    // the institutional one still matches when both agree
    expect(idsOf((await get(`/admin/submissions?search=${mine.santulanId}&institutionId=${inst}&cohortId=${coh}`, admin)).body)).toEqual([mine.santulanId]);
  });

  test('a regex metacharacter is refused, never run as a pattern', async () => {
    for (const hostile of ['.*', 'STN-.*', '(a%2B)%2B$']) {
      const res = await get(`/admin/submissions?search=${hostile}`, admin);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
