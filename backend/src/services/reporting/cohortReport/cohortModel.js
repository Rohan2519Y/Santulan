/*
 * Ported from the Santulan pilot kit 2's santulan_gen/cohort_report.py: constants, workbook "table" reading, and the
 * `Cohort` model (who is included, per-capability statistics, sub-area statistics, answer-style and time figures).
 * Input is a set of tables (arrays of plain row objects keyed by the unified workbook's column names) - from the sample
 * workbook when checking this port against the Python original, or from this platform's database in production
 * (fromDatabase.js). The model refuses (throws a CohortRefusal) exactly where the kit exits: mixed test/real data,
 * mixed questionnaire forms, fewer than MIN_GROUP_N reportable students.
 */
const crypto = require('crypto');
const { pyRound, pyFixed } = require('../../../utils/pyNumber');
const { CFG: BASE_CFG, DOM, ORDER, MIN_ITEMS_PER_DOMAIN, msState, ageBand } = require('../pilotReport/rules');

class CohortRefusal extends Error {
  constructor(code, message) { super(message); this.name = 'CohortRefusal'; this.code = code; }
}

const REPORT_VERSION = 'cohort-v1.2';
const COHORT = {
  MIN_GROUP_N: 10, EXTREME_SHARE: 0.70, MIDDLE_SHARE: 0.60, FAST_RATIO: 1 / 3, SLOW_RATIO: 2.5,
};
const MINN = COHORT.MIN_GROUP_N;
// CFG-06 / CFG-07 (the system's Q10 answer-style rule) are not in the student generator's trimmed CFG; same sheet-21 values.
const CFG = { ...BASE_CFG, 'CFG-06': 0.9, 'CFG-07': 10 };
const BINS = [[1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.01]];
const BAND_LABEL = { D1: 'Ages 13 to 15', D2: 'Ages 16 to 17', D3: 'Ages 18 to 21', D4: 'Ages 22 to 25' };
const HELD_SUB = new Set(['C4.2']);

// Sheet 30 meaning lines are written to the student ("you"); the cohort report must not change their meaning, so each is
// stored with the exact sheet text it was adapted from and a mismatch stops the run (the kit's REL-02).
const MEANING = {
  C1: ["How you notice and look after your body's signals, energy and rest.", "How students notice and look after their body's signals, energy and rest."],
  C2: ['How you notice, understand and handle your feelings.', 'How students notice, understand and handle their feelings.'],
  C3: ['How you read, talk with and work alongside other people.', 'How students read, talk with and work alongside other people.'],
  C4: ['How you understand and describe who you are.', 'How students understand and describe who they are.'],
  C5: ['What matters to you and how you steer towards your future.', 'What matters to students and how they steer towards their future.'],
  C6: ['How you adjust and bounce back when things change or go wrong.', 'How students adjust and bounce back when things change or go wrong.'],
  C7: ['How you plan, start, focus and steer your own learning.', 'How students plan, start, focus and steer their own learning.'],
};

const RELEASE_SUB = {
  C1: ['C1.2', 'C1.3', 'C1.4', 'C1.6'],
  C2: ['C2.1', 'C2.4', 'C2.5', 'C2.11'],
  C3: ['C3.4', 'C3.5', 'C3.8', 'C3.10', 'C3.11'],
  C4: ['C4.1', 'C4.3', 'C4.5'],
  C5: ['C5.1', 'C5.2', 'C5.4', 'C5.5'],
  C6: ['C6.2', 'C6.4', 'C6.6', 'C6.9'],
  C7: ['C7A.1', 'C7A.4', 'C7A.5', 'C7A.6', 'C7B.2', 'C7B.4', 'C7C.1', 'C7C.2'],
};
const SUB_GLOSS = {
  'C1.2': 'How well students rest and recover from tiredness.', 'C1.3': 'How students notice and manage their energy through the day.',
  'C1.4': 'How students look after their body day to day.', 'C1.6': 'How students keep up daily routines that support their wellbeing.',
  'C2.1': 'How well students notice what they are feeling.', 'C2.4': 'How students put feelings into words or actions in a healthy way.',
  'C2.5': 'How students handle strong feelings when they come up.', 'C2.11': 'How quickly students settle after a difficult feeling or event.',
  'C3.4': 'How students share their thoughts and listen to others.', 'C3.5': 'How students work with others towards a shared goal.',
  'C3.8': 'How students deal with disagreements.', 'C3.10': 'Whether students feel able to ask others for help.', 'C3.11': 'How connected students feel to the people around them.',
  'C4.1': 'How clearly students know what they are like.', 'C4.3': 'How well the different parts of a student’s life fit together as “me”.', 'C4.5': 'How much students feel their choices are their own.',
  'C5.1': 'How clearly students know what matters to them.', 'C5.2': 'How much students feel they can make things happen.', 'C5.4': 'How much students think about and look towards their future.', 'C5.5': 'How students weigh options and make choices.',
  'C6.2': 'How students change their way of coping when something is not working.', 'C6.4': 'How students respond when something goes wrong.', 'C6.6': 'How students approach difficult tasks.', 'C6.9': 'How ready students are to adjust when plans or routines change.',
  'C7A.1': 'How students keep attention on a task.', 'C7A.4': 'How easily students get started on a task.', 'C7A.5': 'How students plan steps and time.', 'C7A.6': 'How students keep work in order.',
  'C7B.2': 'How students pick study methods that fit.', 'C7B.4': 'How students use feedback to improve.', 'C7C.1': 'How students set clear goals for themselves.', 'C7C.2': 'How students keep going towards a goal.',
};
const SUB_MIN_ANSWERED = 2;
const SUB_DELTA = 0.3;
const BAND_GAP = 0.3;
const EVIDENCE_STATUS = 'Pilot instrument. Validation work is ongoing.';

// ---------------------------------------------------------------------------------------------------- small helpers
/** Python `dict.get(key, default)`: the default applies only when the key is absent (a present null stays null). */
const getd = (o, k, d) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d);
const isBlank = (v) => v === null || v === undefined || v === '';
const truthy = (v) => ['TRUE', '1', 'YES', 'Y'].includes(String(v).trim().toUpperCase());
const pyStr = (v) => (v === null || v === undefined ? 'None' : String(v));
const upper = (v) => pyStr(v).toUpperCase();

/** Python datetime.fromisoformat: a timestamp without a zone is taken as-is (here: as UTC, so no local-zone shift). */
function parseTs(s) {
  if (s === null || s === undefined) return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  let str = String(s).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(str)) str += 'Z';
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}
const MIN_DATE = new Date(Date.UTC(1, 0, 1));
MIN_DATE.setUTCFullYear(1);

function median(a) {
  const s = [...a].sort((x, y) => x - y); const n = s.length; const h = Math.floor(n / 2);
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
/** statistics.quantiles(data, n=4, method='inclusive') */
function quartiles(data) {
  const d = [...data].sort((x, y) => x - y); const m = d.length - 1; const out = [];
  for (let i = 1; i < 4; i += 1) {
    const j = Math.floor((i * m) / 4); const delta = (i * m) % 4;
    out.push((d[j] * (4 - delta) + d[j + 1] * delta) / 4);
  }
  return out;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
function counter(values) { const c = new Map(); for (const v of values) c.set(v, (c.get(v) || 0) + 1); return c; }
function mostCommonKey(c) { let best = null; let n = -1; for (const [k, v] of c) { if (v > n) { best = k; n = v; } } return best; }
const cnt = (c, k) => c.get(k) || 0;
const objFromMap = (m) => Object.fromEntries(m);

/** Join neighbouring ranges until no range holds 1 to MIN_GROUP_N-1 students; returns [[label, count]]. */
function mergeBins(b) {
  while (b.length > 1) {
    const bad = b.map((x, i) => (x[2] > 0 && x[2] < MINN ? i : -1)).filter((i) => i >= 0);
    if (!bad.length) break;
    const i = bad[0];
    const cand = [i - 1, i + 1].filter((j) => j >= 0 && j < b.length);
    const j = cand.reduce((best, c) => (b[c][2] < b[best][2] ? c : best), cand[0]); // min(); first wins a tie
    const [a, c] = i < j ? [i, j] : [j, i];
    b.splice(a, c - a + 1, [b[a][0], b[c][1], b[a][2] + b[c][2]]);
  }
  return b.map(([lo, hi, n]) => {
    const top = hi > 5 ? 5.0 : hi - 0.1;
    return [`${pyFixed(lo, 1)} to ${pyFixed(top, 1)}`, n];
  });
}

/** A table = rows of the sheet; columns after the first blank header are notes (the kit's own table()). */
function tableFromAoa(aoa) {
  if (!aoa.length) return [];
  let head = aoa[0]; let n = 0;
  while (n < head.length && !(head[n] === null || head[n] === undefined || head[n] === '')) n += 1;
  head = head.slice(0, n);
  const out = [];
  for (const r of aoa.slice(1)) {
    if (!r || r[0] === null || r[0] === undefined || r[0] === '') continue;
    const row = {}; head.forEach((h, i) => { row[h] = r[i] === undefined ? null : r[i]; });
    out.push(row);
  }
  return out;
}

/** Reads the unified workbook from disk (used by the check against the Python kit; production data comes from fromDatabase.js). */
function tablesFromWorkbook(path) {
  const XLSX = require('xlsx');
  const fs = require('fs');
  const buf = fs.readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const tbl = (name) => (wb.SheetNames.includes(name) ? tableFromAoa(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true })) : []);
  let items = [];
  for (const n of wb.SheetNames) if (n.startsWith('ITEM_RESPONSES_LONG')) items = items.concat(tbl(n));
  return {
    tables: { P: tbl('PARTICIPANTS'), ident: tbl('IDENTITY'), att: tbl('ATTEMPTS'), dom: tbl('DOMAIN_RESULTS'), items, codebook: tbl('ITEM_CODEBOOK'), config: tbl('CONFIG') },
    sha: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

// ---------------------------------------------------------------------------------------------------- the model
function buildCohort(tables, { institution, cohort = null, final = false, approvedBy = null, grant = null, enrolled = null, sha }) {
  const m = { enrolled, final, approved_by: approvedBy, grant, sha };
  const Pall = tables.P.filter((p) => p.institution_code === institution && (cohort === null || p.cohort_code === cohort));
  if (!Pall.length) throw new CohortRefusal('NO_PARTICIPANTS', `no participants for institution=${institution} cohort=${cohort === null ? 'None' : cohort}`);
  const ident = new Map(tables.ident.map((r) => [r.participant_research_id, r]));
  m.institution = institution; m.cohort = cohort || 'ALL';
  m.log = [];

  const P = [];
  for (const p of Pall) {
    if (String(p.consent_status).toUpperCase() !== 'VERIFIED') { m.log.push(`excluded ${p.participant_research_id}: consent_status ${p.consent_status}`); continue; }
    if (String(p.participant_status).toUpperCase() === 'WITHDRAWN') { m.log.push(`excluded ${p.participant_research_id}: WITHDRAWN`); continue; }
    P.push(p);
  }
  m.n_records = Pall.length;
  m.n_consent_out = m.log.filter((l) => l.includes('consent_status')).length;
  m.n_withdrawn = m.log.filter((l) => l.includes('WITHDRAWN')).length;
  const kinds = new Set(P.map((p) => String(p.participant_status).toUpperCase()));
  const hasSample = kinds.has('TEST') || kinds.has('DEMO');
  const hasReal = [...kinds].some((k) => k !== 'TEST' && k !== 'DEMO');
  if (hasSample && hasReal) throw new CohortRefusal('MIXED_SAMPLE_REAL', 'REN-15: sample (TEST/DEMO) and real participants are mixed in one cohort; refusing');
  m.sample = hasSample;
  const ids = new Set(P.map((p) => p.participant_research_id));
  m.P = new Map(P.map((p) => [p.participant_research_id, p]));

  // latest submitted attempt per person
  const best = new Map();
  for (const a of tables.att) {
    if (!ids.has(a.participant_research_id) || String(a.attempt_status).toUpperCase() !== 'SUBMITTED') continue;
    const t = parseTs(a.submitted_at) || MIN_DATE;
    const cur = best.get(a.participant_research_id);
    if (!cur || t.getTime() >= cur[0].getTime()) best.set(a.participant_research_id, [t, a]);
  }
  m.A = new Map([...best].map(([pid, v]) => [pid, v[1]]));
  const forms = new Set([...m.A.values()].map((a) => String(getd(a, 'assessment_form', null))));
  if (forms.size > 1) throw new CohortRefusal('MIXED_FORMS', `cohort mixes questionnaire forms ${JSON.stringify([...forms].sort())}; make one report per form`);
  m.form = forms.size ? [...forms][0] : '';
  m.dates = [...best.values()].map((v) => v[0]).filter((d) => d.getUTCFullYear() > 1).sort((a, b) => a - b);
  m.n_submitted = m.A.size;
  const st = counter([...m.A.values()].map((a) => String(a.report_state).toUpperCase()));
  m.n_normal = cnt(st, 'NORMAL'); m.n_hold = cnt(st, 'QUALITY_HOLD'); m.n_invalid = cnt(st, 'INVALID');
  const normal = new Map([...m.A].filter(([, a]) => String(a.report_state).toUpperCase() === 'NORMAL'));
  if (normal.size < MINN) throw new CohortRefusal('COHORT_TOO_SMALL', `cohort too small: ${normal.size} reportable students, minimum is ${MINN} (OD-18). No report made.`);
  m.N = normal.size;
  m.attempt_of = new Map([...normal].map(([pid, a]) => [pid, a.attempt_id]));
  m.pid_of = new Map([...m.attempt_of].map(([p, a]) => [a, p]));
  m.band = new Map();
  for (const [pid, a] of normal) m.band.set(pid, ageBand(parseInt(a.age_years_at_attempt, 10)));
  m.bands = counter([...m.band.values()]);
  m.age_years = counter([...normal.values()].map((a) => parseInt(a.age_years_at_attempt, 10)));
  m.n_submitted_not_included = m.n_submitted - m.N;
  m.versions = {
    scoring: [...new Set([...normal.values()].map((a) => String(a.scoring_version)))].sort(),
    questionnaire: [...new Set([...normal.values()].map((a) => String(a.assessment_version)))].sort(),
  };

  // domain results, state recomputed from counts (same rule as the student generator)
  m.D = Object.fromEntries(ORDER.map((k) => [k, []]));
  for (const r of tables.dom) {
    const pid = m.pid_of.get(r.attempt_id);
    if (pid === undefined || !(r.domain_code in m.D)) continue;
    const exp = parseInt(r.items_expected || 0, 10); const ans = parseInt(r.items_answered || 0, 10);
    const share = exp ? 1 - ans / exp : 1.0;
    let s = msState(pyRound(share, 6));
    if (exp < MIN_ITEMS_PER_DOMAIN) s = 'MS04';
    let mean = (s === 'MS01' || s === 'MS02') && !isBlank(r.domain_mean) ? parseFloat(r.domain_mean) : null;
    if (mean === null && (s === 'MS01' || s === 'MS02')) s = 'MS04';
    m.D[r.domain_code].push({ pid, mean, state: s });
  }

  // item level: answer style and time (only included attempts; held items never counted)
  const cb = new Map(tables.codebook.map((c) => [c.item_code, c]));
  m.sub_names = [...new Set(tables.codebook.filter((c) => c.subdomain_name).map((c) => String(c.subdomain_name)))].sort();
  m.sub_codes = [...new Set(tables.codebook.filter((c) => c.subdomain_code).map((c) => String(c.subdomain_code)))].sort();
  const byatt = new Map(); const tms = new Map(); const stamps = new Map(); const subv = new Map();
  const nested = (map, k) => { if (!map.has(k)) map.set(k, new Map()); return map.get(k); };
  let hasMs = false;
  for (const r of tables.items) {
    if (!m.pid_of.has(r.attempt_id)) continue;
    if (!truthy(getd(r, 'is_current', true)) || String(getd(r, 'missing_flag', null)).toUpperCase() === 'YES' || isBlank(getd(r, 'response_value', null))) continue;
    const cbRow = cb.get(r.item_code) || {};
    const sub = getd(r, 'subdomain_code', null) || getd(cbRow, 'subdomain_code', null);
    if (HELD_SUB.has(sub)) continue;
    const dc = r.domain_code;
    const raw = Math.trunc(parseFloat(r.response_value));
    const per = nested(byatt, r.attempt_id); if (!per.has(dc)) per.set(dc, []); per.get(dc).push(raw);
    let xv = raw;
    if (['NEGATIVE', 'REVERSE', 'REVERSED'].includes(String(getd(cbRow, 'keying', null)).toUpperCase())) xv = 6 - xv;
    if (sub) { const sv = nested(subv, r.attempt_id); if (!sv.has(sub)) sv.set(sub, []); sv.get(sub).push(xv); }
    if (!isBlank(getd(r, 'time_spent_ms', null))) {
      const tt = nested(tms, r.attempt_id); tt.set(dc, (tt.get(dc) || 0) + parseFloat(r.time_spent_ms)); hasMs = true;
    }
    const t = parseTs(getd(r, 'response_timestamp', null));
    if (t) { if (!stamps.has(r.attempt_id)) stamps.set(r.attempt_id, []); stamps.get(r.attempt_id).push(t); }
  }
  m.style = Object.fromEntries(ORDER.map((k) => [k, { ext: 0, mid: 0, same: 0, n: 0 }]));
  for (const [, per] of byatt) {
    for (const [k, vals] of per) {
      if (!(k in m.style)) continue;
      const s = m.style[k]; s.n += 1;
      if (vals.length >= 1 && vals.filter((v) => v === 1 || v === 5).length / vals.length >= COHORT.EXTREME_SHARE) s.ext += 1;
      if (vals.length >= 1 && vals.filter((v) => v === 3).length / vals.length >= COHORT.MIDDLE_SHARE) s.mid += 1;
      if (vals.length >= CFG['CFG-07']) {
        const c = counter(vals);
        if ([1, 5].some((e) => cnt(c, e) / vals.length >= CFG['CFG-06'])) s.same += 1;
      }
    }
  }
  m.time_basis = hasMs ? 'measured' : 'elapsed';
  m.t_total = new Map(); m.t_dom = Object.fromEntries(ORDER.map((k) => [k, []]));
  for (const aid of m.pid_of.keys()) {
    if (hasMs) {
      const per = tms.get(aid) || new Map();
      const tot = sum([...per.values()]) / 60000.0;
      if (tot > 0) {
        m.t_total.set(aid, tot);
        for (const k of ORDER) if (per.get(k)) m.t_dom[k].push(per.get(k) / 60000.0);
      }
    } else if ((stamps.get(aid) || []).length > 1) {
      const s = stamps.get(aid);
      m.t_total.set(aid, (Math.max(...s.map((d) => d.getTime())) - Math.min(...s.map((d) => d.getTime()))) / 1000 / 60.0);
    }
  }
  m.cfg_used = Object.fromEntries(['CFG-01', 'CFG-02', 'CFG-06', 'CFG-07', 'CFG-20', 'CFG-21', 'CFG-22', 'CFG-23', 'CFG-24'].map((k) => [k, CFG[k]]));
  const last = m.dates.length ? m.dates[m.dates.length - 1] : new Date();
  const ymd = `${last.getUTCFullYear()}${String(last.getUTCMonth() + 1).padStart(2, '0')}${String(last.getUTCDate()).padStart(2, '0')}`;
  const alnum = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '');
  m.report_id = `SANT-COH-${alnum(institution)}-${alnum(m.cohort)}-${ymd}`;
  const instNames = [...m.P.keys()].filter((p) => ident.has(p) && ident.get(p).institution_name).map((p) => ident.get(p).institution_name);
  m.inst_name = instNames.length ? instNames[0] : institution;
  m.locale = mostCommonKey(counter([...m.P.values()].map((p) => String(p.administration_language))));
  m.draft = !final;
  m.stats = Object.fromEntries(ORDER.map((k) => [k, domainStats(m, k)]));
  const active = (c) => String(getd(c, 'status', 'ACTIVE')).toUpperCase() === 'ACTIVE';
  m.n_questions = tables.codebook.filter((c) => active(c) && !HELD_SUB.has(getd(c, 'subdomain_code', null))).length;
  m.n_sub_total = new Set(tables.codebook.map((c) => getd(c, 'subdomain_code', null)).filter((c) => c && !HELD_SUB.has(c))).size;
  m.has_reverse = tables.codebook.some((c) => ['NEGATIVE', 'REVERSE', 'REVERSED'].includes(String(getd(c, 'keying', null)).toUpperCase()));
  m.item_table = {};
  for (const k of ORDER) {
    const it = tables.codebook.filter((c) => getd(c, 'domain_code', null) === k && active(c));
    const held = it.filter((c) => HELD_SUB.has(getd(c, 'subdomain_code', null))).length;
    m.item_table[k] = { admin: it.length, held, scored: it.length - held };
  }
  const subname = {};
  for (const c of tables.codebook) if (getd(c, 'subdomain_code', null)) subname[c.subdomain_code] = c.subdomain_name;
  m.sub = subStats(m, subv, subname);
  let rsn = 0; let rse = 0; let rsm = 0;
  for (const [, per] of byatt) {
    const v = [].concat(...per.values());
    if (!v.length) continue;
    rsn += 1;
    if (v.filter((x) => x === 1 || x === 5).length / v.length >= COHORT.EXTREME_SHARE) rse += 1;
    if (v.filter((x) => x === 3).length / v.length >= COHORT.MIDDLE_SHARE) rsm += 1;
  }
  m.rs = { n: rsn, ext: rse, mid: rsm };
  m.finish_all = [...normal.values()].filter((a) => parseInt(getd(a, 'missing_item_count', 0) || 0, 10) === 0).length;
  const comp = [...normal.values()].filter((a) => !isBlank(getd(a, 'completion_pct', null))).map((a) => parseFloat(a.completion_pct)).sort((x, y) => x - y);
  m.med_completion = comp.length ? median(comp) : null;
  const have = new Map();
  for (const k of ORDER) for (const r of m.D[k]) if (r.mean !== null) have.set(r.pid, (have.get(r.pid) || 0) + 1);
  m.all7 = [...m.pid_of.values()].filter((pid) => have.get(pid) === 7).length;
  return m;
}

function domainStats(m, k) {
  const rows = m.D[k]; const ok = rows.filter((r) => r.state === 'MS01' || r.state === 'MS02');
  const c = counter(rows.map((r) => r.state));
  const s = { n_all: rows.length, n: ok.length, complete: cnt(c, 'MS01'), early: cnt(c, 'MS02'), none: cnt(c, 'MS03') + cnt(c, 'MS04') };
  s.scored = ok.length >= MINN;
  if (s.scored) {
    const v = ok.map((r) => r.mean);
    s.avg = sum(v) / v.length;
    const q = quartiles(v); s.q1 = q[0]; s.q3 = q[2];
    s.bins = mergeBins(BINS.map(([lo, hi]) => [lo, hi, v.filter((x) => lo <= pyRound(x, 2) && pyRound(x, 2) < hi).length]));
    const by = new Map();
    for (const r of ok) { const b = m.band.get(r.pid); if (!by.has(b)) by.set(b, []); by.get(b).push(r.mean); }
    const small = [...by].filter(([, l]) => l.length < MINN);
    s.band_ok = !small.length;
    s.band = {};
    if (!small.length) for (const b of [...by.keys()].sort()) s.band[b] = [by.get(b).length, sum(by.get(b)) / by.get(b).length];
    s.time = m.t_dom[k].length >= MINN ? median(m.t_dom[k]) : null;
  }
  return s;
}

function subStats(m, subv, cbmap) {
  const out = {};
  m.released_names = new Set();
  for (const dc of ORDER) {
    const capavg = m.stats[dc].scored ? m.stats[dc].avg : null;
    const rows = [];
    for (const code of RELEASE_SUB[dc]) {
      const name = cbmap[code] || code; m.released_names.add(name);
      const vals = [];
      for (const r of m.D[dc]) {
        if (r.mean === null) continue;
        const sv = subv.get(m.attempt_of.get(r.pid));
        const l = sv ? sv.get(code) : undefined;
        if (l && l.length >= SUB_MIN_ANSWERED) vals.push(sum(l) / l.length);
      }
      const d = { code, name, gloss: SUB_GLOSS[code], n: vals.length, shown: vals.length >= MINN && capavg !== null };
      if (d.shown) {
        const q = quartiles(vals); const avg = sum(vals) / vals.length;
        Object.assign(d, { avg, q1: q[0], q3: q[2], delta: avg - capavg });
      }
      rows.push(d);
    }
    out[dc] = rows;
  }
  return out;
}

module.exports = {
  CohortRefusal, REPORT_VERSION, COHORT, MINN, CFG, BAND_LABEL, MEANING, RELEASE_SUB, SUB_MIN_ANSWERED, SUB_DELTA, BAND_GAP, EVIDENCE_STATUS,
  buildCohort, tablesFromWorkbook, median, quartiles, counter, cnt, objFromMap, isBlank, upper, DOM,
};
