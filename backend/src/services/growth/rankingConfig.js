/*
 * Research-stage growth-priority ranking (BUILD 07 §11 PG-04, audit B07-AUD-009). The weights are configuration read from
 * GROWTH_RANKING_PATH, never validated cutoffs and never hard-coded. With no (or an invalid) file the ranking is neutral: canonical
 * domain order, which involves no score-derived judgement at all. The participant's choice always overrides the ranking.
 */
const fs = require('fs');
const config = require('../../config');

const KEYS = ['evidence', 'need', 'completeness'];

function loadRanking(path = config.growthRankingPath) {
  if (!path) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    const weights = raw && raw.weights;
    const values = raw && raw.evidenceValues;
    if (!weights || !values) return null;
    for (const k of KEYS) if (typeof weights[k] !== 'number' || weights[k] < 0) return null;
    for (const v of Object.values(values)) if (typeof v !== 'number' || v < 0 || v > 1) return null;
    return { version: String(raw.version || 'unversioned'), weights, evidenceValues: values };
  } catch (err) {
    return null;                                                             // missing / invalid: neutral order
  }
}

/**
 * candidates: [{ domain, score, completeness, state }]. Returns them ordered, at most one per domain (PG-03), best first.
 * Index = wE * evidenceValue(state) + wN * need + wC * completeness, need = (5 - score) / 4 (a planning signal, not a capability judgement).
 */
function rankCandidates(candidates, ranking = loadRanking()) {
  const byDomain = new Map();
  for (const c of candidates) if (!byDomain.has(c.domain)) byDomain.set(c.domain, c);      // PG-03: one per domain
  const list = [...byDomain.values()];
  if (!ranking) return list.sort((a, b) => (a.domain < b.domain ? -1 : 1));
  const index = (c) => {
    const need = Math.min(1, Math.max(0, (5 - c.score) / 4));
    return ranking.weights.evidence * (ranking.evidenceValues[c.state] ?? 0) + ranking.weights.need * need + ranking.weights.completeness * c.completeness;
  };
  return list.sort((a, b) => (index(b) - index(a)) || (a.domain < b.domain ? -1 : 1));
}

module.exports = { loadRanking, rankCandidates };
