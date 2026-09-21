/* The 50 named indexes exist by name and definition, and the uniqueness guarantees behave (G-08..G-12, G-28; B05-001, T03, T04). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');
const { indexes, devIndexes } = require('../../../db/schema');

const fx = H.withFixtures('indexes');
afterAll(async () => { await fx.cleanup(); await H.closeAll(); });

const dup = (p) => H.expectRefused(p, 11000);

describe('G-08 index catalogue', () => {
  test('G-08 there are exactly 50 canonical named indexes, none anonymous', () => {
    expect(indexes).toHaveLength(50);
    expect(new Set(indexes.map((i) => i.name)).size).toBe(50);
    expect(indexes.every((i) => /^(uq|idx)_/.test(i.name))).toBe(true);
    expect(devIndexes.map((i) => i.name)).toEqual(['uq_dev_identity']);
  });

  test('G-08 every index exists in the database by name and definition', async () => {
    const db = await H.admin();
    for (const def of [...indexes, ...devIndexes]) {
      const live = (await db.collection(def.collection).indexes()).find((i) => i.name === def.name);
      expect(live).toBeTruthy();
      expect(live.key).toEqual(def.keys);
      expect(!!live.unique).toBe(def.unique);
      expect(live.partialFilterExpression || null).toEqual(def.partial);
    }
  });
});

describe('G-08 one non-terminal attempt per participant (B05-001)', () => {
  test('B05-001 a second non-terminal attempt is refused; terminal ones do not count', async () => {
    const p = F.participant();
    const v = F.versionDoc();
    await fx.insertRuntime('assessment_attempts', F.attempt(p._id, v._id, { status: 'IN_PROGRESS' }));
    await dup(fx.insertRuntime('assessment_attempts', F.attempt(p._id, v._id, { status: 'CREATED' })));
    // terminal attempts (REPORT_READY, INVALID, EXPIRED) are not counted
    const q = F.participant();
    for (const s of ['REPORT_READY', 'INVALID', 'EXPIRED', 'REPORT_READY']) await fx.insertRuntime('assessment_attempts', F.attempt(q._id, v._id, { status: s }));
    await fx.insertRuntime('assessment_attempts', F.attempt(q._id, v._id, { status: 'CREATED' }));
    await dup(fx.insertRuntime('assessment_attempts', F.attempt(q._id, v._id, { status: 'SCORED' })));
  });
});

describe('G-09 answers', () => {
  test('B05-002 exactly one current answer per attempt and question; versions unique', async () => {
    const aid = F.attempt(F.participant()._id, F.versionDoc()._id)._id;
    const iid = F.item(F.versionDoc()._id)._id;
    const first = await fx.insertRuntime('responses', F.response(aid, iid, { response_version: 1, is_current: true }));
    await dup(fx.insertRuntime('responses', F.response(aid, iid, { response_version: 2, is_current: true }))); // second current
    await dup(fx.insertRuntime('responses', F.response(aid, iid, { response_version: 1, is_current: false }))); // same version
    await fx.insertRuntime('responses', F.response(aid, iid, { response_version: 2, is_current: false, supersedes_response_id: first._id }));
    await dup(fx.insertRuntime('responses', F.response(aid, iid, { idempotency_key: first.idempotency_key, response_version: 3, is_current: false })));
  });
});

describe('G-10 consents', () => {
  test('T04-020 one verified consent per participant/type/protocol; one active per type/protocol', async () => {
    const pid = F.participant()._id;
    await fx.insertRuntime('consents', F.verifiedConsent(pid));
    await dup(fx.insertRuntime('consents', F.verifiedConsent(pid)));
    await dup(fx.insertRuntime('consents', F.consent(pid))); // PENDING while an active one exists
    await fx.insertRuntime('consents', F.verifiedConsent(pid, { protocol_version: 'FX-PROTOCOL-2' }));
    const qid = F.participant()._id;
    await fx.insertRuntime('consents', F.consent(qid, { status: 'WITHDRAWN', withdrawn_at: new Date(Date.now() + 1000) }));
    await fx.insertRuntime('consents', F.consent(qid)); // a withdrawn one does not block a new one
  });
});

describe('G-11 identifiers', () => {
  test('T03-020 unique Santulan id, auth pair, and external id per institution', async () => {
    const p = await fx.insertRuntime('participants', F.participant({ auth_provider: 'fx', auth_provider_subject_id: 'SUBJ-1' }));
    await dup(fx.insertRuntime('participants', F.participant({ santulan_id: p.santulan_id })));
    await dup(fx.insertRuntime('participants', F.participant({ auth_provider: 'fx', auth_provider_subject_id: 'SUBJ-1' })));
    await fx.insertRuntime('participants', F.participant()); // two participants with no auth pair are fine

    const inst = await fx.insertRuntime('institutions', F.institution());
    const inst2 = await fx.insertRuntime('institutions', F.institution());
    const coh = await fx.insertRuntime('cohorts', F.cohort(inst._id));
    const coh2 = await fx.insertRuntime('cohorts', F.cohort(inst2._id));
    const mk = (i, c, ext) => F.participant({ participation_route: 'INSTITUTIONAL', institution_id: i._id, cohort_id: c._id, external_student_id: ext });
    await fx.insertRuntime('participants', mk(inst, coh, 'FX-EXT-1'));
    await dup(fx.insertRuntime('participants', mk(inst, coh, 'FX-EXT-1')));
    await fx.insertRuntime('participants', mk(inst2, coh2, 'FX-EXT-1')); // reusable across institutions
    await dup(fx.insertRuntime('institutions', F.institution({ institution_code: inst.institution_code })));
    await dup(fx.insertRuntime('cohorts', F.cohort(inst._id, { cohort_code: coh.cohort_code })));
  });

  test('B07-090 one report per attempt; one submit key per attempt; one score key', async () => {
    const pid = F.participant()._id;
    const vid = F.versionDoc()._id;
    const aid = F.attempt(pid, vid)._id;
    await fx.insertRuntime('reports', F.report(pid, aid));
    await dup(fx.insertRuntime('reports', F.report(pid, aid)));
    await fx.insertRuntime('response_events', F.responseEvent(aid, { event_type: 'SUBMIT', metadata: { idempotency_key: 'K1' } }));
    await dup(fx.insertRuntime('response_events', F.responseEvent(aid, { event_type: 'SUBMIT', metadata: { idempotency_key: 'K1' } })));
    await fx.insertRuntime('response_events', F.responseEvent(aid, { event_type: 'PAUSE', metadata: { idempotency_key: 'K1' } })); // only SUBMIT events are constrained
    await fx.insertRuntime('score_results', F.score(aid, pid, vid, { domain_code: 'C1' }));
    await dup(fx.insertRuntime('score_results', F.score(aid, pid, vid, { domain_code: 'C1' })));
    await fx.insertRuntime('score_results', F.score(aid, pid, vid, { domain_code: 'C1', scoring_version: 'domain-mean-v2' }));
    await fx.insertRuntime('quality_flags', F.qualityFlag(aid, { flag_code: 'Q07', domain_code: 'C1' }));
    await dup(fx.insertRuntime('quality_flags', F.qualityFlag(aid, { flag_code: 'Q07', domain_code: 'C1' })));
    await fx.insertRuntime('quality_flags', F.qualityFlag(aid, { flag_code: 'Q06', domain_code: null }));
    await dup(fx.insertRuntime('quality_flags', F.qualityFlag(aid, { flag_code: 'Q06', domain_code: null }))); // a null domain equals a null domain
  });
});

describe('G-12 question sets and G-28 wording', () => {
  test('G-12 at most one OPEN set per age group', async () => {
    const open = (o) => F.versionDoc({ status: 'FROZEN', frozen_at: new Date(), participation_state: 'OPEN', ...o });
    await fx.insertRuntime('assessment_versions', open({ configuration: 'ADOLESCENT' }));
    await dup(fx.insertRuntime('assessment_versions', open({ configuration: 'ADOLESCENT' })));
    await fx.insertRuntime('assessment_versions', open({ configuration: 'EMERGING_ADULT', participant_min_age: 18, participant_max_age: 25 }));
    // closed sets never collide
    await fx.insertRuntime('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date() }));
    await fx.insertRuntime('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date() }));
  });

  test('G-12 one live revision per label (superseded revisions are RETIRED)', async () => {
    const label = `fx-label-${Date.now()}`;
    await fx.insertRuntime('assessment_versions', F.versionDoc({ version_label: label, revision: 1, status: 'DRAFT' }));
    await dup(fx.insertRuntime('assessment_versions', F.versionDoc({ version_label: label, revision: 2, status: 'DRAFT' })));
    await dup(fx.insertRuntime('assessment_versions', F.versionDoc({ version_label: label, revision: 2, status: 'FROZEN', frozen_at: new Date() })));
    await fx.insertRuntime('assessment_versions', F.versionDoc({ version_label: label, revision: 3, status: 'RETIRED' }));
  });

  test('G-28 one APPROVED wording per exact dimension; a band-specific and a band-less wording may coexist', async () => {
    const vid = (await fx.insertRuntime('assessment_versions', F.versionDoc()))._id;
    const dim = { domain_code: 'C2', evidence_state: 'S2', locale: 'en', layer: 'MEANING' };
    await fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, developmental_band: null, status: 'APPROVED' }));
    await dup(fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, developmental_band: null, status: 'APPROVED' })));
    await fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, developmental_band: 'D2', status: 'APPROVED' }));
    await fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, developmental_band: null, status: 'DRAFT' })); // drafts never collide
    await fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, layer: 'PATTERN', developmental_band: null, status: 'APPROVED' }));
    await fx.insertRuntime('interpretation_rules', F.rule(vid, { ...dim, locale: 'hi', developmental_band: null, status: 'APPROVED' }));
  });
});
