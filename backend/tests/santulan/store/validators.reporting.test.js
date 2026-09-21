/* reports, report_sections, growth_*, pathway_* (G-29; B07-003, RC-11). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

afterAll(async () => { await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);
const pid = F.participant()._id;
const vid = F.versionDoc()._id;
const aid = F.attempt(pid, vid)._id;
const HASH = F.hex('report');

describe('G-29 reports', () => {
  test('B07-003 a terminal report always carries a 64-hex content_hash', async () => {
    for (const s of ['REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE']) {
      expect(await ok('reports', F.report(pid, aid, { generation_status: s, content_hash: HASH, generated_at: new Date() }))).toBe(true);
      expect(await ok('reports', F.report(pid, aid, { generation_status: s, content_hash: null }))).toBe(false);
    }
  });
  test('RC-11 PENDING and FAILED_RETRYABLE never carry a hash', async () => {
    for (const s of ['PENDING', 'FAILED_RETRYABLE']) {
      expect(await ok('reports', F.report(pid, aid, { generation_status: s, content_hash: null }))).toBe(true);
      expect(await ok('reports', F.report(pid, aid, { generation_status: s, content_hash: HASH }))).toBe(false);
    }
  });
  test('B07-004 the hash is exactly 64 lowercase hex; retry_count >= 0; status enum', async () => {
    expect(await ok('reports', F.report(pid, aid, { generation_status: 'REPORT_READY', content_hash: 'abc' }))).toBe(false);
    expect(await ok('reports', F.report(pid, aid, { generation_status: 'REPORT_READY', content_hash: HASH.toUpperCase() }))).toBe(false);
    expect(await ok('reports', F.report(pid, aid, { retry_count: -1 }))).toBe(false);
    expect(await ok('reports', F.report(pid, aid, { generation_status: 'DONE' }))).toBe(false);
  });
});

describe('report_sections', () => {
  const rid = F.report(pid, aid)._id;
  test('B07-005 section type enum and display_order > 0', async () => {
    for (const t of ['PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'PRIORITY', 'ACTION', 'CHANGE', 'UNDER_REVIEW', 'NOT_ELIGIBLE']) {
      expect(await ok('report_sections', F.reportSection(rid, { section_type: t }))).toBe(true);
    }
    expect(await ok('report_sections', F.reportSection(rid, { section_type: 'SUMMARY' }))).toBe(false);
    expect(await ok('report_sections', F.reportSection(rid, { display_order: 0 }))).toBe(false);
    expect(await ok('report_sections', F.reportSection(rid, { content_snapshot: '' }))).toBe(false);
  });
});

describe('growth and pathways', () => {
  test('B07-037 growth plan status enum; priority rank > 0', async () => {
    expect(await ok('growth_plans', F.growthPlan(pid, aid, vid))).toBe(true);
    expect(await ok('growth_plans', F.growthPlan(pid, aid, vid, { status: 'DONE' }))).toBe(false);
    const prio = { _id: F.hex('p').slice(0, 8) + '-0000-4000-8000-000000000003', plan_id: F.growthPlan(pid, aid, vid)._id, domain_code: 'C1', candidate_rank: 1, participant_selected: false, priority_text: 'x', created_at: new Date() };
    expect(await ok('growth_priorities', prio)).toBe(true);
    expect(await ok('growth_priorities', { ...prio, candidate_rank: 0 })).toBe(false);
    expect(await ok('growth_priorities', { ...prio, candidate_rank: null })).toBe(true);
  });
  test('B07-038 pathway decision status is S0..S7 and code P1..P5', async () => {
    for (const s of ['S0', 'S1', 'S7']) expect(await ok('pathway_decisions', F.pathwayDecision(pid, aid, { status: s }))).toBe(true);
    expect(await ok('pathway_decisions', F.pathwayDecision(pid, aid, { status: 'S8' }))).toBe(false);
    expect(await ok('pathway_decisions', F.pathwayDecision(pid, aid, { pathway_code: 'P6' }))).toBe(false);
    expect(await ok('pathway_decisions', F.pathwayDecision(pid, aid, { review_due: '2026-12-31' }))).toBe(true);
    expect(await ok('pathway_decisions', F.pathwayDecision(pid, aid, { review_due: '31/12/2026' }))).toBe(false);
  });
});
