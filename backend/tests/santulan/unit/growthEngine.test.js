/*
 * Growth Plan Engine helpers (BUILD 07 §11): research-stage ranking (PG-03/04 - configuration, not validated cutoffs) and the
 * application-side "observable goal" check (PG-06). Pure functions, no database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rankCandidates, loadRanking } = require('../../../src/modules/santulan/growth/rankingConfig');
const { assertObservableGoal } = require('../../../src/modules/santulan/growth/growthService');

const cand = (domain, score, extra = {}) => ({ domain, score, completeness: 1, state: 'S2', ...extra });
const tmp = [];
const writeConfig = (data) => {
  const file = path.join(os.tmpdir(), `santulan-rank-${Date.now()}-${tmp.length}.json`);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  tmp.push(file);
  return file;
};
afterAll(() => tmp.forEach((file) => fs.rmSync(file, { force: true })));

describe('ranking (PG-03, PG-04, B07-AUD-009)', () => {
  test('with no configuration the order is neutral (canonical domain order), independent of any score', () => {
    const list = [cand('C5', 1.2), cand('C1', 4.9), cand('C3', 2.5)];
    expect(rankCandidates(list, null).map((c) => c.domain)).toEqual(['C1', 'C3', 'C5']);
    expect(rankCandidates([...list].reverse(), null).map((c) => c.domain)).toEqual(['C1', 'C3', 'C5']);
  });

  test('PG-03 at most one candidate per domain survives the ranking', () => {
    expect(rankCandidates([cand('C2', 3), cand('C2', 2), cand('C1', 3)], null).map((c) => c.domain)).toEqual(['C1', 'C2']);
  });

  test('configured weights change the order; ties fall back to domain order; the ranking is deterministic', () => {
    const cfg = { version: 'r-test', weights: { evidence: 0, need: 1, completeness: 0 }, evidenceValues: { S2: 0.5 } };
    const list = [cand('C1', 4.5), cand('C2', 2), cand('C3', 2)];
    expect(rankCandidates(list, cfg).map((c) => c.domain)).toEqual(['C2', 'C3', 'C1']);                    // higher planning need first, C2 before C3 on the tie
    expect(rankCandidates([...list].reverse(), cfg).map((c) => c.domain)).toEqual(['C2', 'C3', 'C1']);
    const evidenceOnly = { version: 'r-test', weights: { evidence: 1, need: 0, completeness: 0 }, evidenceValues: { S2: 0.5, S3: 0.9 } };
    expect(rankCandidates([cand('C1', 3), cand('C2', 3, { state: 'S3' })], evidenceOnly).map((c) => c.domain)).toEqual(['C2', 'C1']);
  });

  test('the config file is read from disk; a missing, malformed or invalid file falls back to the neutral order', () => {
    expect(loadRanking('')).toBeNull();
    expect(loadRanking('/definitely/not/here.json')).toBeNull();
    expect(loadRanking(writeConfig('{not json'))).toBeNull();
    expect(loadRanking(writeConfig({ weights: { evidence: -1, need: 1, completeness: 1 }, evidenceValues: {} }))).toBeNull();
    expect(loadRanking(writeConfig({ weights: { evidence: 1, need: 1, completeness: 1 }, evidenceValues: { S2: 7 } }))).toBeNull();
    const ok = loadRanking(writeConfig({ version: 'v', weights: { evidence: 1, need: 2, completeness: 3 }, evidenceValues: { S2: 0.5 } }));
    expect(ok).toMatchObject({ version: 'v', weights: { need: 2 } });
    const shipped = loadRanking(path.join(__dirname, '..', '..', '..', 'config', 'growth-ranking.example.json'));
    expect(shipped.version).toBe('growth-ranking-research-v0');                                             // the shipped template loads but is labelled research-stage
  });
});

describe('observable goals (PG-06)', () => {
  test('behaviours are accepted', () => {
    for (const text of ['Ask one clarifying question in each group discussion', 'Write down three things I noticed after class', 'Take a five minute walk before I study']) {
      expect(() => assertObservableGoal(text)).not.toThrow();
    }
  });

  test('trait / feeling goals and one-word goals are refused with a VALIDATION_ERROR', () => {
    for (const text of ['Be confident', 'become more confident at school', 'I want to feel happy', 'Get better', 'Stay motivated', 'Try']) {
      expect(() => assertObservableGoal(text)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    }
  });
});
