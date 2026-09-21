/* Research-safe views (G-16; B08-025, AT-30). The runtime credential reads views without rights on the sources. */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

const fx = H.withFixtures('views');
afterAll(async () => { await fx.cleanup(); await H.closeAll(); });

const FORBIDDEN = ['participant_id', 'auth_provider', 'auth_provider_subject_id', 'external_student_id', 'email', 'mobile', 'guardian_name', 'guardian_email'];
const hasForbidden = (obj) => Object.keys(obj).some((k) => FORBIDDEN.includes(k));

let world;
beforeAll(async () => {
  const inst = await fx.insertAdmin('institutions', F.institution());
  const coh = await fx.insertAdmin('cohorts', F.cohort(inst._id));
  const p = await fx.insertAdmin('participants', F.participant({
    participation_route: 'INSTITUTIONAL', institution_id: inst._id, cohort_id: coh._id, external_student_id: 'FX-EXT-SECRET', auth_provider: 'fx', auth_provider_subject_id: 'FX-SUBJ-SECRET',
  }));
  const set = await fx.insertAdmin('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date() }));
  const i1 = await fx.insertAdmin('items', F.item(set._id, { item_code: 'C1-01', display_order: 1, options: F.options(3) }));
  const att = await fx.insertAdmin('assessment_attempts', F.attempt(p._id, set._id, { status: 'SCORED' }));
  const resp = await fx.insertAdmin('responses', F.response(att._id, i1._id, { response_value: '2' }));
  const ev = await fx.insertAdmin('response_events', F.responseEvent(att._id, { event_type: 'SUBMIT', metadata: { idempotency_key: 'SECRET-KEY', note: 'kept' } }));
  await fx.insertAdmin('score_results', F.score(att._id, p._id, set._id, { domain_code: 'C1' }));
  const q07 = await fx.insertAdmin('quality_flags', F.qualityFlag(att._id, { flag_code: 'Q07', domain_code: 'C1' }));
  const q09 = await fx.insertAdmin('quality_flags', F.qualityFlag(att._id, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null, reviewed_by: F.admin()._id, reviewed_at: new Date(), review_note: 'SECRET NOTE' }));
  world = { inst, coh, p, set, i1, att, resp, ev, q07, q09 };
});

const find = async (name, filter = {}) => (await H.runtime()).collection(name).find(filter).toArray();

describe('G-16 read-only views', () => {
  test('B08-025 find on each v_research_* view works and writes are refused', async () => {
    const db = await H.runtime();
    for (const v of ['v_research_participants', 'v_research_attempts', 'v_research_item_responses', 'v_research_domain_scores', 'v_research_quality_flags',
      'v_research_response_events', 'v_research_assessment_versions', 'v_research_cohorts']) {
      expect(Array.isArray(await find(v))).toBe(true);
      await H.expectRefused(db.collection(v).insertOne({ a: 1 }), 13);
      await H.expectRefused(db.collection(v).updateOne({}, { $set: { a: 1 } }), 13);
    }
  });

  test('AT-30 v_research_participants exposes santulan_id and no direct identifier', async () => {
    const rows = await find('v_research_participants', { santulan_id: world.p.santulan_id });
    expect(rows).toHaveLength(1);
    expect(rows[0].santulan_id).toBe(world.p.santulan_id);
    expect(hasForbidden(rows[0])).toBe(false);
    expect(JSON.stringify(rows[0])).not.toContain('SECRET');
    expect(rows[0].institution_code).toBe(world.inst.institution_code);
    expect(rows[0].cohort_code).toBe(world.coh.cohort_code);
    expect(rows[0].participant_status).toBe('ACTIVE');
  });

  test('AT-30 no research view ever exposes the participant id or contact/guardian fields', async () => {
    for (const v of ['v_research_attempts', 'v_research_item_responses', 'v_research_domain_scores', 'v_research_quality_flags', 'v_research_response_events']) {
      const rows = await find(v, { attempt_id: world.att._id });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(hasForbidden(r)).toBe(false);
        expect(r.santulan_id).toBe(world.p.santulan_id);
        expect(JSON.stringify(r)).not.toContain(world.p._id);
      }
    }
  });

  test('AT-30 v_research_quality_flags excludes Q09 and carries no reviewer id or note', async () => {
    const rows = await find('v_research_quality_flags', { attempt_id: world.att._id });
    expect(rows.map((r) => r.flag_code)).toEqual(['Q07']);
    for (const r of rows) {
      expect(r).not.toHaveProperty('reviewed_by');
      expect(r).not.toHaveProperty('review_note');
    }
    expect(JSON.stringify(rows)).not.toContain('SECRET NOTE');
  });

  test('B08-026 v_research_domain_scores carries eligible_items, valid_items and completeness_status', async () => {
    const rows = await find('v_research_domain_scores', { attempt_id: world.att._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain_code: 'C1', eligible_items: 10, valid_items: 10, completeness_status: 'COMPLETE', score_status: 'S1' });
  });

  test('B08-027 v_research_item_responses carries the chosen position and the question option count', async () => {
    const rows = await find('v_research_item_responses', { attempt_id: world.att._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_code: 'C1-01', response_value: '2', option_count: 3, is_current: true });
  });

  test('B08-028 v_research_response_events.metadata has no idempotency_key', async () => {
    const rows = await find('v_research_response_events', { attempt_id: world.att._id });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ note: 'kept' });
  });

  test('B08-029 assessment version and cohort views keep their labelled fields', async () => {
    const v = await find('v_research_assessment_versions', { assessment_version_id: world.set._id });
    expect(v[0]).toMatchObject({ version_label: world.set.version_label, revision: 1, configuration: 'ADOLESCENT', status: 'FROZEN' });
    const c = await find('v_research_cohorts', { cohort_id: world.coh._id });
    expect(c[0]).toMatchObject({ institution_code: world.inst.institution_code, cohort_code: world.coh.cohort_code });
  });
});

describe('research-only candidate subdomain view', () => {
  test('SC-016 v_candidate_subdomain_scores uses the position rule and flags held subdomains (migrator credential only)', async () => {
    const admin = await H.admin();
    // one C1.1 answer at position 2 of 3 options => 1 + (2-1)*4/(3-1) = 3
    const rows = await admin.collection('v_candidate_subdomain_scores').find({ attempt_id: world.att._id }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subdomain_code: 'C1.1', domain_code: 'C1', answered_items: 1, candidate_mean: 3, interpretation_hold: false });
    expect(rows[0].eligible_items).toBe(1);
    await H.expectRefused((await H.runtime()).collection('v_candidate_subdomain_scores').find({}).toArray(), 13);
  });

  test('SC-016 Self-Worth (C4.2) and Savoring (C2.10) are marked interpretation_hold', async () => {
    const admin = await H.admin();
    const set = world.set;
    for (const [code, dom, order, name] of [['C4.2', 'C4', 2, 'Self-Worth'], ['C2.10', 'C2', 3, 'Savoring']]) {
      const it = await fx.insertAdmin('items', F.item(set._id, { item_code: `${dom}-0${order}`, domain_code: dom, subdomain_code: code, subdomain_name: name, display_order: order + 10, options: F.options(5) }));
      await fx.insertAdmin('responses', F.response(world.att._id, it._id, { response_value: '5' }));
    }
    const rows = await admin.collection('v_candidate_subdomain_scores').find({ attempt_id: world.att._id }).toArray();
    const byCode = Object.fromEntries(rows.map((r) => [r.subdomain_code, r]));
    expect(byCode['C4.2'].interpretation_hold).toBe(true);
    expect(byCode['C2.10'].interpretation_hold).toBe(true);
    expect(byCode['C1.1'].interpretation_hold).toBe(false);
    expect(byCode['C4.2'].candidate_mean).toBe(5);
  });
});
