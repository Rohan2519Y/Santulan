/*
 * Ported from the Santulan pilot kit 2's santulan_gen/cohort_report.py: run() - the release gates, the text checks (REN-xx),
 * the headless-browser layout check (qa.JS) and the manifest. Takes the unified-workbook tables (from the platform database via
 * fromDatabase.js, or from a workbook for checking this port against the Python original) and returns the HTML, the PDF,
 * the manifest and the QA result. Nothing is written to disk unless `outdir` is given.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pyRound } = require('../../../utils/pyNumber');
const C = require('../pilotReport/content');
const { DOM, ORDER } = require('../pilotReport/rules');
const M = require('./cohortModel');
const PG = require('./cohortPages');

const { CohortRefusal, REPORT_VERSION, COHORT, MINN, MEANING, SUB_MIN_ANSWERED, SUB_DELTA, EVIDENCE_STATUS, buildCohort } = M;
const { CAPTION } = PG;

const EXTRA_FORBIDDEN = [/\blow\b/i, /\bhigh\b/i, /\blower\b/i, /\bhigher\b/i, /\bweakness/i, /\bstrength/i, /\bgrit\b/i, /\bpersonality\b/i,
  /vocational/i, /cognitive abilit/i, /emotional intelligence/i, /learning strateg/i, /\bwheel\b/i, /self-worth/i, /savou?ring/i,
  /\bC4\.2\b/i, /\bpercentile/i, /\bnorm\b/i, /\bnorms\b/i, /\bSTEN\b/i, /\bintelligen/i, /\btalent/i, /\bgrade[sd]?\b/i, /\blevel/i, /\bmarks?\b/i,
  /\bassessment\b/i, /\btest\b/i, /\bexam\b/i, /\bworth a closer look/i, /\bproblem/i, /\bat risk/i, /\bdiagnos/i];
const ALLOW_TEXT = ['is not a measure of ability, intelligence or performance', 'It does not diagnose students', 'they are not levels or grades', 'They are not performance levels, grades, stages or categories'];

// qa.py JS, verbatim in behaviour: overlap / overflow / small-text detection on each .p page
const QA_JS = () => {
  const res = { overlap: [], overflow: [], small: [], pages: 0 };
  const pages = Array.from(document.querySelectorAll('.p'));
  res.pages = pages.length;
  pages.forEach((p, pi) => {
    const pr = p.getBoundingClientRect();
    const items = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode; if (!t.textContent.trim()) continue;
      const el = t.parentElement; if (seen.has(el)) continue; seen.add(el);
      if (el.closest('.draft')) continue;
      const range = document.createRange(); range.selectNodeContents(t);
      const r = range.getBoundingClientRect(); if (r.width < 2) continue;
      items.push({ el, r, txt: t.textContent.trim().slice(0, 40), fs: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName });
      if (r.bottom > pr.bottom - 14 || r.right > pr.right - 6 || r.left < pr.left) res.overflow.push([pi + 1, t.textContent.trim().slice(0, 40)]);
    }
    const svgs = Array.from(p.querySelectorAll('svg[aria-label]')).map((s) => ({ r: s.getBoundingClientRect(), txt: `svg:${s.getAttribute('aria-label').slice(0, 30)}` }));
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i].r; const b = items[j].r;
        if (items[i].el.contains(items[j].el) || items[j].el.contains(items[i].el)) continue;
        if (items[i].el.closest('svg') && items[j].el.closest('svg') && items[i].el.closest('svg') === items[j].el.closest('svg')) continue;
        const li = items[i].el.closest('li,p,h1,h2,h3'); if (li && li === items[j].el.closest('li,p,h1,h2,h3')) continue;
        const sh = (rr) => { const d = rr.height * 0.14; return { left: rr.left, right: rr.right, top: rr.top + d, bottom: rr.bottom - d }; };
        const A = sh(a); const B = sh(b);
        const w = Math.min(A.right, B.right) - Math.max(A.left, B.left); const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w > 3 && h > 3) res.overlap.push([pi + 1, items[i].txt, items[j].txt]);
      }
      for (const s of svgs) {
        if (items[i].el.closest('svg') || items[i].el.closest('.lg')) continue;
        if (s.r.width > 500) continue;
        const a = items[i].r; const b = s.r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 3 && h > 3) res.overlap.push([pi + 1, items[i].txt, s.txt]);
      }
      if ((items[i].tag === 'P' || items[i].tag === 'LI') && items[i].fs < 14) res.small.push([pi + 1, items[i].txt, items[i].fs]);
    }
  });
  return res;
};

// ---------------------------------------------------------------------------------------------------- text checks
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&middot;': '·', '&nbsp;': ' ' };
const unescapeHtml = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|#x27|middot|nbsp);/g, (x) => ENT[x]);
function textOf(doc) {
  const body = doc.replace(/<style>.*?<\/style>|<title>.*?<\/title>/gs, ' ');
  return unescapeHtml(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
const escapeNoQuote = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const replaceAll = (s, a, b) => s.split(a).join(b);

function check(m, doc, kinds) {
  const F = []; const W = [];
  let text = textOf(doc);
  for (const a of ALLOW_TEXT) text = replaceAll(text, a, ' ');
  const low = text.toLowerCase();
  const lowC = replaceAll(low, CAPTION.toLowerCase(), ' ');
  for (const t of [...C.FORBIDDEN, ...C.RETIRED]) if (lowC.includes(t)) F.push(`REN-03/21 forbidden or retired term "${t.trim()}"`);
  const noCaption = replaceAll(text, CAPTION, ' ');
  for (const pat of EXTRA_FORBIDDEN) if (pat.test(noCaption)) F.push(`REN-03/07/21, MP20 term matches /${pat.source}/`);
  if (/\brank/.test(lowC)) F.push('MP20 ranking language');
  let lowd = low;
  for (const k of ORDER) lowd = replaceAll(lowd, DOM[k].name.toLowerCase(), ' ');
  for (const n of m.sub_names) if (n && !m.released_names.has(n) && lowd.includes(n.toLowerCase())) F.push(`REN-08 subdomain name visible: ${n}`);
  if (/\bC[1-7]\.\d\b/.test(text)) F.push('REN-08 subdomain code visible');
  const names = ORDER.map((k) => DOM[k].name);
  const secs = doc.match(/<section class="p".*?<\/section>/gs) || [];
  const pageOf = (kind) => secs.filter((_, i) => kinds[i] === kind);
  for (const [kind, label] of [['seven', 'overview'], ['snap', 'snapshot'], ['blocks', 'capability blocks']]) {
    const joined = pageOf(kind).join(' '); const t = unescapeHtml(joined);
    for (const nm of names) if (!joined.includes(escapeNoQuote(nm)) && !t.includes(nm)) F.push(`REN-02 ${nm} missing from ${label}`);
  }
  const firstPage = pageOf('seven').length ? unescapeHtml(pageOf('seven')[0]) : '';
  const idx = names.map((nm) => firstPage.indexOf(nm));
  if (JSON.stringify(idx) !== JSON.stringify([...idx].sort((a, b) => a - b))) F.push('REN-07 capabilities are not in C1 to C7 order on the overview');
  if (!text.includes(CAPTION)) F.push('REN-04 radar caption missing or changed');
  for (const [k, s] of Object.entries(m.stats)) {
    if (!s.scored && s.avg && text.includes(`Average ${require('../../../utils/pyNumber').pyFixed(s.avg, 1)}`)) F.push(`REN-06 number shown for ${k}`);
  }
  if (m.draft && !doc.includes('DRAFT')) F.push('REN-15/18 draft mark missing');
  if (m.sample && !doc.includes('SAMPLE')) F.push('REN-15 sample mark missing');
  if (!m.draft && (!m.approved_by || !m.grant)) F.push('REN-18/19 final report without approver and sharing grant');
  for (const mt of text.matchAll(/\b(\d+)\s+students\s+(?:gave|have|show|took)/g)) if (parseInt(mt[1], 10) < MINN) F.push(`MIN-N a count under ${MINN} is shown: "${mt[0]}"`);
  return { F, W };
}

async function layoutCheck(page, doc, nExpected) {
  await page.setContent(doc);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(QA_JS);
  const F = []; const W = [];
  if (r.pages !== nExpected) F.push(`page count ${r.pages} != expected ${nExpected}`);
  for (const x of r.overlap) F.push(`REN-11 overlap p${x[0]}: "${x[1]}" x "${x[2]}"`);
  for (const x of r.overflow) F.push(`REN-11 overflow p${x[0]}: "${x[1]}"`);
  for (const x of r.small.slice(0, 12)) W.push(`CFG-27 body text ${require('../../../utils/pyNumber').pyFixed(x[2], 1)}px on p${x[0]}: "${x[1]}"`);
  return { F, W };
}

// ---------------------------------------------------------------------------------------------------- manifest
function manifestOf(m) {
  const domains = {};
  for (const [k, s] of Object.entries(m.stats)) domains[k] = { state: s.scored ? 'scored' : 'not_enough_data', n: s.n, avg_shown: s.scored ? pyRound(s.avg, 1) : null, complete: s.complete, early: s.early, none: s.none };
  const subAreas = {};
  for (const [k, v] of Object.entries(m.sub)) subAreas[k] = v.map((r) => ({ code: r.code, name: r.name, shown: r.shown, n: r.n, avg: r.shown ? pyRound(r.avg, 2) : null }));
  return {
    report_id: m.report_id, version: REPORT_VERSION, institution: m.institution, cohort: m.cohort, draft: m.draft, sample: m.sample,
    input_sha256: m.sha, students: m.N, submitted: m.n_submitted, held: m.n_hold, invalid: m.n_invalid, bands: M.objFromMap(m.bands),
    versions: m.versions, thresholds: { config: m.cfg_used, cohort_proposed: COHORT }, time_basis: m.time_basis, domains,
    approved_by: m.approved_by, sharing_grant: m.grant, enrolled: m.enrolled, sub_areas: subAreas, sub_thresholds: { min_answered: SUB_MIN_ANSWERED, delta: SUB_DELTA },
    form: m.form, item_table: m.item_table, evidence_status: EVIDENCE_STATUS,
    psychometric_review_required: ['item-weighted scoring vs sub-area-weighted scoring', 'missing-data thresholds (CFG-01)', 'sub-area reporting rules'],
    finished_all_questions: m.finish_all, number_in_all_seven: m.all7, left_out: m.log,
  };
}

/**
 * Builds one institution cohort report.
 * @param {{P:object[],ident:object[],att:object[],dom:object[],items:object[],codebook:object[],config:object[]}} tables
 * @param {object} o  { institution, cohort?, final?, approvedBy?, grant?, enrolled?, contacts?, helplineVerified?, sha, pdf?, outdir?, browserInstance? }
 * @returns {Promise<{html:string, pdf:Buffer|null, manifest:object, failures:string[], warnings:string[], pages:number, base:string|null}>}
 */
async function generateCohortReport(tables, o) {
  const { institution, cohort = null, final = false, approvedBy = null, grant = null, enrolled = null, helplineVerified = null, sha, pdf = true, layout = true, outdir = null, browserInstance = null } = o;
  for (const [k, [sheetText]] of Object.entries(MEANING)) {
    if (DOM[k].meaning.trim() !== sheetText) throw new CohortRefusal('MEANING_CHANGED', `REL-02: sheet 30 meaning line for ${k} changed; update MEANING in cohortModel.js`);
  }
  if (final) {
    if (!(approvedBy && grant)) throw new CohortRefusal('FINAL_NEEDS_APPROVAL', 'REN-18/REN-19: final needs approvedBy and sharingGrant');
    if (!C.CONTENT_APPROVED) throw new CohortRefusal('CONTENT_NOT_APPROVED', 'OD-13: final refused because content is still AUTHORED-SAMPLE (content.CONTENT_APPROVED is False)');
  }
  const contacts = Object.fromEntries(Object.entries(o.contacts || {}).filter(([, v]) => v));
  const contactsOk = ['counsellor', 'safety_lead', 'school_contact', 'escalation'].every((k) => contacts[k]);
  if (final && !contactsOk) throw new CohortRefusal('FINAL_NEEDS_CONTACTS', 'REN-18: final needs counsellor, safety lead, school contact and escalation (no blank safeguarding contacts in a released report)');
  if (final && !helplineVerified) throw new CohortRefusal('FINAL_NEEDS_HELPLINE_DATE', 'REN-18: final needs the helplines-verified-on date');

  const m = buildCohort(tables, { institution, cohort, final, approvedBy, grant, enrolled, sha });
  m.contacts = contacts; m.helpline_verified = helplineVerified;
  m.blockers = [...(C.CONTENT_APPROVED ? [] : ['content not approved (OD-13, OD-23)']), 'evidence and references missing (OD-25)', 'pilot thresholds unconfirmed (OD-18, OD-19, OD-24)', 'scoring weights and missing-data rule need psychometric review',
    ...(contactsOk ? [] : ['safeguarding contacts incomplete']), ...(helplineVerified ? [] : ['helpline verification date missing'])];
  const { pages, kinds } = PG.build(m);
  const doc = PG.document(m, pages);
  const t = check(m, doc, kinds);
  const F = [...t.F]; const W = [...t.W];

  // The browser (layout check and PDF) is only started when asked for; an HTML-only run is text work and needs no Chromium.
  let pdfBuf = null;
  if (pdf || layout) {
    const ownBrowser = !browserInstance;
    const browser = browserInstance || await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      try {
        if (layout) {
          const lc = await layoutCheck(page, doc, pages.length);
          F.push(...lc.F); W.push(...lc.W);
        } else {
          await page.setContent(doc);
          await page.waitForTimeout(1200);
        }
        if (pdf && !F.length) {
          pdfBuf = await page.pdf({ width: '794px', height: '1123px', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
        }
      } finally { await page.close(); }
    } finally { if (ownBrowser) await browser.close(); }
  }

  const manifest = { ...manifestOf(m), pages: kinds, qa: { fail: F, warn: W }, release_blockers: m.blockers };
  let base = null;
  if (outdir) {
    fs.mkdirSync(outdir, { recursive: true });
    const al = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '');
    base = path.join(outdir, `SANT-COHORT_${al(institution)}_${al(m.cohort)}_${m.locale}_${REPORT_VERSION}`);
    fs.writeFileSync(`${base}.html`, doc);
    fs.writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 1));
    if (pdfBuf) fs.writeFileSync(`${base}.pdf`, pdfBuf);
  }
  return { html: doc, pdf: pdfBuf, manifest, failures: F, warnings: W, pages: pages.length, base };
}

module.exports = { generateCohortReport, check, textOf, CohortRefusal };
