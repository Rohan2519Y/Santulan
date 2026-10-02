/*
 * Ported from the Santulan pilot kit's santulan_gen/generate.py: the `Model` class - "Everything the templates need,
 * computed once. No template does its own scoring." This is the actual decision engine: given one student's raw domain
 * answers (already scored upstream - see the file header note below), it decides which domains are reportable, what band
 * they fall in, and which strengths/explore/plan domains apply. Property names are kept identical to the Python source
 * (m.d, m.d1, m.rel, m.band, ...) on purpose: the page-builder port (next) references them exactly this way throughout.
 *
 * Note on scoring: the kit's own adapter_export.py can derive domains[].mean/answered/total itself from raw item
 * responses, but its own INTEGRATION.md says the preferred path is "the engine sends the means; the adapter only maps" -
 * exactly what our unifiedWorkbookWriter.js's DOMAIN_RESULTS already does (including the C4.2 exclusion, A12). This
 * module therefore takes already-scored domains as input; it does not rescore.
 */
const { CFG, BAND_HIGH, BAND_LOW, MIN_ITEMS_PER_DOMAIN, ORDER, msState, ageBand } = require('./rules');
const C = require('./content');

const round1 = (x) => Math.round(x * 10) / 10;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * @param {object} s student input: { status, release:{priority,action,ifthen,review}, age, first_name, display_name,
 *   domains: { C1: { answered, total, mean } | undefined, ... }, goals: string[], plan: string[], previous }
 * @param {{ final?: boolean }} [opts]
 */
function buildModel(s, { final = false } = {}) {
  const status = s.status || 'normal';
  const rel = { priority: false, action: false, ifthen: false, review: false, ...(s.release || {}) };
  const band = ageBand(Number(s.age));
  const d1 = band === 'D1';
  const draft = !final;
  const first = s.first_name || s.display_name.split(/\s+/)[0];

  const d = {};
  for (const k of ORDER) {
    const x = s.domains && s.domains[k];
    if (x == null) { d[k] = { key: k, state: 'MS04', share: 1.0, mean: null, scored: false, band: null }; continue; }
    let share = 1 - x.answered / x.total;
    let st = msState(round6(share));
    if (x.total < MIN_ITEMS_PER_DOMAIN) { st = 'MS04'; share = 1.0; } // form too short to report this domain
    const scored = st === 'MS01' || st === 'MS02';
    const mean = scored ? round1(Number(x.mean)) : null;
    const b = !scored ? null : (x.mean >= BAND_HIGH ? 'high' : x.mean >= BAND_LOW ? 'mid' : 'low');
    d[k] = { key: k, state: st, share, mean, raw: x.mean, scored, band: b };
  }

  const sc = ORDER.filter((k) => d[k].scored);
  const strengths = sc.filter((k) => d[k].raw >= BAND_LOW).slice(0, CFG['CFG-25']);
  const explore = sc.filter((k) => d[k].raw < BAND_LOW).slice(0, CFG['CFG-26']);
  const goals = (s.goals || []).filter((g) => C.GOALS[g]);
  const plan = (s.plan || []).filter((k) => ORDER.includes(k)).slice(0, 2);
  const prev = s.previous || null;

  // visible-value manifest for QA (the kit's REN-06 etc.)
  const manifest = () => Object.fromEntries(ORDER.map((k) => [k, { state: d[k].state, mean_shown: d[k].mean }]));

  return { s, final, status, rel, band, d1, draft, first, d, strengths, explore, goals, plan, prev, manifest };
}

module.exports = { buildModel };
