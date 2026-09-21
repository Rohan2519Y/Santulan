/* quality_flags and score_results, runtime credential (G-05, G-06; B06-011..015, B06-032). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

afterAll(async () => { await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);
const pid = F.participant()._id;
const vid = F.versionDoc()._id;
const aid = F.attempt(pid, vid)._id;
const S = (o) => F.score(aid, pid, vid, o);

/** A score row built to be internally consistent for (valid, eligible). */
const row = (valid, eligible, status, o = {}) => S({
  valid_items: valid,
  eligible_items: eligible,
  completeness_rate: Math.round((valid / eligible) * 10000) / 10000,
  completeness_status: status,
  raw_score: status === 'INSUFFICIENT' ? null : 4.0,
  score_status: status === 'INSUFFICIENT' ? 'S0' : 'S1',
  ...o,
});

describe('G-06 quality_flags', () => {
  test('B06-011 Q09 must be CRITICAL', async () => {
    expect(await ok('quality_flags', F.qualityFlag(aid, { flag_code: 'Q09', severity: 'CRITICAL' }))).toBe(true);
    for (const s of ['LOW', 'MEDIUM', 'HIGH']) expect(await ok('quality_flags', F.qualityFlag(aid, { flag_code: 'Q09', severity: s }))).toBe(false);
    expect(await ok('quality_flags', F.qualityFlag(aid, { flag_code: 'Q07', severity: 'LOW' }))).toBe(true);
  });
  test('B06-012 reviewer pair is all-or-none', async () => {
    const adminId = F.admin()._id;
    expect(await ok('quality_flags', F.qualityFlag(aid, { reviewed_by: adminId, reviewed_at: new Date() }))).toBe(true);
    expect(await ok('quality_flags', F.qualityFlag(aid, { reviewed_by: adminId }))).toBe(false);
    expect(await ok('quality_flags', F.qualityFlag(aid, { reviewed_at: new Date() }))).toBe(false);
  });
  test('B06-013 flag codes Q01..Q09 and disposition enum', async () => {
    expect(await ok('quality_flags', F.qualityFlag(aid, { flag_code: 'Q10' }))).toBe(false);
    expect(await ok('quality_flags', F.qualityFlag(aid, { disposition: 'IGNORED' }))).toBe(false);
  });
});

describe('G-05 score_results', () => {
  test('B06-014 raw_score is null or 1.00 to 5.00', async () => {
    expect(await ok('score_results', S({ raw_score: 1 }))).toBe(true);
    expect(await ok('score_results', S({ raw_score: 5 }))).toBe(true);
    expect(await ok('score_results', S({ raw_score: 0.99 }))).toBe(false);
    expect(await ok('score_results', S({ raw_score: 5.01 }))).toBe(false);
  });

  test('B06-015 completeness_rate 0..1, equal to valid / eligible, valid <= eligible', async () => {
    expect(await ok('score_results', row(9, 10, 'COMPLETE_WITH_MISSING', { completeness_rate: 0.5 }))).toBe(false);
    expect(await ok('score_results', row(11, 10, 'COMPLETE'))).toBe(false);
    expect(await ok('score_results', S({ completeness_rate: 1.2 }))).toBe(false);
    expect(await ok('score_results', row(9, 10, 'COMPLETE_WITH_MISSING'))).toBe(true);
  });

  test('B06-032 completeness_status follows exact integer arithmetic at the boundaries', async () => {
    const good = [
      [10, 10, 'COMPLETE'], [9, 10, 'COMPLETE_WITH_MISSING'], [8, 10, 'INCOMPLETE'], [7, 10, 'INCOMPLETE'], [6, 10, 'INSUFFICIENT'], [0, 10, 'INSUFFICIENT'],
      [4, 5, 'INCOMPLETE'], [3, 5, 'INSUFFICIENT'], [5, 8, 'INCOMPLETE'], [6, 8, 'INCOMPLETE'], [7, 8, 'COMPLETE_WITH_MISSING'], [1, 1, 'COMPLETE'],
    ];
    for (const [v, e, st] of good) expect(await ok('score_results', row(v, e, st))).toBe(true);
    const bad = [
      [10, 10, 'COMPLETE_WITH_MISSING'], [9, 10, 'COMPLETE'], [8, 10, 'COMPLETE_WITH_MISSING'], [8, 10, 'INSUFFICIENT'], [6, 10, 'INCOMPLETE'], [3, 5, 'INCOMPLETE'], [5, 8, 'INSUFFICIENT'],
    ];
    for (const [v, e, st] of bad) {
      expect(await ok('score_results', row(v, e, st, { raw_score: st === 'INSUFFICIENT' ? null : 4, score_status: st === 'INSUFFICIENT' ? 'S0' : 'S1' }))).toBe(false);
    }
  });

  test('B06-033 60 percent complete is INSUFFICIENT: no score and evidence S0, all together', async () => {
    expect(await ok('score_results', row(6, 10, 'INSUFFICIENT'))).toBe(true);
    expect(await ok('score_results', row(6, 10, 'INSUFFICIENT', { raw_score: 3.0 }))).toBe(false); // a score on an insufficient domain
    expect(await ok('score_results', row(6, 10, 'INSUFFICIENT', { score_status: 'S1' }))).toBe(false);
    expect(await ok('score_results', row(10, 10, 'COMPLETE', { raw_score: null }))).toBe(false); // no score on a complete domain
    expect(await ok('score_results', row(10, 10, 'COMPLETE', { score_status: 'S0' }))).toBe(false); // S0 only with INSUFFICIENT
  });

  test('B06-034 INCOMPLETE is never S2 or higher', async () => {
    for (const s of ['S1', 'SH']) expect(await ok('score_results', row(8, 10, 'INCOMPLETE', { score_status: s }))).toBe(true);
    for (const s of ['S2', 'S3', 'S4', 'S5']) expect(await ok('score_results', row(8, 10, 'INCOMPLETE', { score_status: s }))).toBe(false);
    for (const s of ['S2', 'S3']) expect(await ok('score_results', row(10, 10, 'COMPLETE', { score_status: s }))).toBe(true);
  });

  test('B06-035 eligible_items >= 1 and valid_items >= 0', async () => {
    expect(await ok('score_results', S({ eligible_items: 0, valid_items: 0 }))).toBe(false);
    expect(await ok('score_results', S({ valid_items: -1 }))).toBe(false);
  });
});
