/*
 * Ported from the Santulan pilot kit's santulan_gen/generate.py - the HTML page-builder functions (everything from
 * "styling" through "assembly" in the source). Faithful line-for-line port: same CSS, same page geometry, same wording
 * placement. PDF rendering and the Playwright-based `measure` function pack_details() needs are NOT here - this module
 * only builds HTML strings, exactly like generate.py's own functions do before `run()` hands them to Playwright.
 */
const fs = require('fs');
const path = require('path');
const { ORDER, CFG } = require('./rules');
const C = require('./content');
const { pyFixed } = require('../../../utils/pyNumber');

const TEMPLATES = path.join(__dirname, 'templates');
const read = (name) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');

// html.escape(str(s), quote=False): escapes & < > only, not quotes
const E = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------------------- styling
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&amp;family=Plus+Jakarta+Sans:wght@300;400;500;700;800&amp;display=swap">';
const CSS = `
@page{size:794px 1123px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Plus Jakarta Sans','Segoe UI',Arial,sans-serif;color:#1E2350;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{width:794px;height:1123px;position:relative;overflow:hidden;background:#fff;page-break-after:always;break-after:page}
.p:last-child{page-break-after:auto;break-after:auto}
.lg{position:absolute;left:36px;top:26px;display:flex;align-items:center;gap:8px;font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:600;z-index:3}
.ft{position:absolute;left:64px;right:64px;bottom:22px;display:flex;justify-content:space-between;font-size:11px;color:#6B7280;z-index:3}
.draft{position:absolute;right:36px;top:24px;z-index:9;border:1.5px solid #7A4A00;background:#FCE9C2;color:#7A4A00;border-radius:999px;padding:3px 11px;font-size:11px;font-weight:800;letter-spacing:.05em}
.blk{margin-top:30px}.blk:first-child{margin-top:0}
.hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.hd h3{margin:0;font-size:24px;font-weight:800;color:#1E2A5A}
.chip{font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;background:#E5E1F7;color:#3C3489}
.chip.e{background:#FCE9C2;color:#7A4A00}.chip.g{background:#E5E7EB;color:#374151}
.sub{font-size:14px;color:#4B5563;margin-top:2px}
.lb{font-size:12px;font-weight:800;letter-spacing:.07em;margin-top:9px;color:#5A4BA8}
.lb.t{color:#1F7A63}.lb.q{color:#B03F6B}
.blk p{margin:3px 0 0;font-size:15px;line-height:1.55}
.card{border-radius:16px;padding:16px}.card b.k{display:block;font-weight:800;font-size:14px}.card div{font-size:14px;line-height:1.5;margin-top:5px}
table.snap{border-collapse:collapse;width:100%;font-size:14px}
table.snap th{text-align:left;font-size:12px;letter-spacing:.06em;color:#4B5563;padding:4px 8px;border-bottom:2px solid #D9D4EE}
table.snap td{padding:4px 8px;border-bottom:1px solid #ECE8F5}
h1,h2,h3,p{margin-top:0}
`;

function logo(fill = '#1E2350', accent = '#A9B0E3') {
  const color = fill !== '#FFFFFF' ? fill : '#FFFFFF';
  return `<div class="lg" style="color:${color}"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M2 4h22L13 24z" fill="${fill}"/><path d="M6 6h14l-7 13z" fill="${accent}"/></svg>Santulan</div>`;
}

function footer(m, no, color) {
  const st = color ? ` style="color:${color}"` : '';
  return `<div class="ft"${st}><span>${E(m.s.display_name)} &middot; ${E(m.s.report_id)}</span><span>Page ${no}</span></div>`;
}

const draftTag = (m) => (m.draft ? '<div class="draft">DRAFT &middot; content pending review</div>' : '');

function page(m, inner, no, extraStyle = '', foot = true, fcolor = null) {
  return `<section class="p" style="${extraStyle}">${draftTag(m)}${inner}${foot ? footer(m, no, fcolor) : ''}</section>`;
}

function icon(k, color, size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 26 26" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${C.ICON[k]}</svg>`;
}

const cl = (k) => C.CLUSTER[require('./rules').DOM[k].cluster];

// ----------------------------------------------------------------------------------------------------- radar (REN-04/05/07)
function radarSvg(m, width = 490) {
  const cx = 210; const cy = 210; const R = 140; const n = 7;
  const ang = Array.from({ length: n }, (_, i) => ((-90 + (i * 360) / n) * Math.PI) / 180);
  const pt = (i, v) => { const r = (R * (v - 1)) / 4; return [cx + r * Math.cos(ang[i]), cy + r * Math.sin(ang[i])]; };
  const fmt = (p) => `${pyFixed(p[0], 1)},${pyFixed(p[1], 1)}`;

  const out = [`<svg viewBox="-70 20 560 400" width="${width}" height="${(width * 400) / 560}" role="img" aria-label="Radar chart of seven areas. Scale 1 to 5. Areas without enough data are shown as dashed lines." style="font-family:'Plus Jakarta Sans',sans-serif">`];
  out.push('<g fill="none" stroke="#D3CEE8" stroke-width="1">');
  for (const v of [2, 3, 4, 5]) out.push(`<polygon points="${Array.from({ length: n }, (_, i) => fmt(pt(i, v))).join(' ')}"/>`);
  ORDER.forEach((k, i) => { if (m.d[k].scored) { const [x, y] = pt(i, 5); out.push(`<line x1="210" y1="210" x2="${pyFixed(x, 1)}" y2="${pyFixed(y, 1)}"/>`); } });
  out.push('</g>');
  ORDER.forEach((k, i) => { if (!m.d[k].scored) { const [x, y] = pt(i, 5); out.push(`<line x1="210" y1="210" x2="${pyFixed(x, 1)}" y2="${pyFixed(y, 1)}" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="4 4"/>`); } });
  out.push(`<g fill="#6B7280" font-size="9">${[2, 3, 4, 5].map((v) => `<text x="214" y="${pyFixed(cy - (R * (v - 1)) / 4 - 4, 0)}">${v}</text>`).join('')}</g>`);

  const P = {};
  ORDER.forEach((k, i) => { if (m.d[k].scored) P[i] = pt(i, m.d[k].raw); });
  const have = Object.keys(P).length;
  if (have === n) {
    out.push(`<path d="M${Array.from({ length: n }, (_, i) => fmt(P[i])).join(' L')} Z" fill="#7C6BD0" fill-opacity="0.22"/>`);
    out.push(`<path d="M${Array.from({ length: n }, (_, i) => fmt(P[i])).join(' L')} Z" fill="none" stroke="#5A4BA8" stroke-width="2.6" stroke-linejoin="round"/>`);
  } else {
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      if (P[i] && P[j]) out.push(`<path d="M${fmt(P[i])} L${fmt(P[j])}" stroke="#5A4BA8" stroke-width="2.6" stroke-linecap="round"/>`);
    }
    for (let i = 0; i < n; i += 1) {
      if (!P[i]) {
        const a = (i - 1 + n) % n; const b = (i + 1) % n; const e = pt(i, 5);
        if (P[a]) out.push(`<path d="M${fmt(P[a])} L${fmt(e)}" stroke="#9CA3AF" stroke-width="1.6" stroke-dasharray="5 5"/>`);
        if (P[b]) out.push(`<path d="M${fmt(e)} L${fmt(P[b])}" stroke="#9CA3AF" stroke-width="1.6" stroke-dasharray="5 5"/>`);
      }
    }
  }
  out.push(`<g fill="#2E2A6B" stroke="#FFFFFF" stroke-width="2">${Object.values(P).map((p) => `<circle cx="${pyFixed(p[0], 1)}" cy="${pyFixed(p[1], 1)}" r="5.5"/>`).join('')}</g>`);

  ORDER.forEach((k, i) => {
    const d = m.d[k];
    const ax = cx + (R + 20) * Math.cos(ang[i]); const ay = cy + (R + 20) * Math.sin(ang[i]);
    const c = Math.cos(ang[i]);
    const anchor = Math.abs(c) < 0.3 ? 'middle' : (c > 0 ? 'start' : 'end');
    const words = require('./rules').DOM[k].name.split(' ');
    const lines = []; let cur = '';
    for (const w of words) { if (cur.length + w.length + 1 > 17 && cur) { lines.push(cur); cur = w; } else cur = `${cur} ${w}`.trim(); }
    lines.push(cur);
    const sub = d.scored ? pyFixed(d.mean, 1) : 'Not enough data yet';
    const allL = [...lines, sub];
    const y0 = Math.abs(c) >= 0.3 ? ay - ((allL.length - 1) * 14) / 2 : (Math.sin(ang[i]) < 0 ? ay - allL.length * 14 + 6 : ay + 8);
    const col = d.scored ? '#1E2350' : '#4B5563';
    const t = allL.map((x, j) => `<text x="${pyFixed(ax, 1)}" y="${pyFixed(y0 + j * 14, 1)}" text-anchor="${anchor}" font-size="12" font-weight="${j === allL.length - 1 ? 500 : 800}" fill="${col}">${E(x)}</text>`).join('');
    out.push(t);
  });
  out.push('</svg>');
  return out.join('');
}

// ------------------------------------------------------------------------------------------------------------- pages
const fmtDate = (s) => {
  const d = new Date(`${s}T00:00:00`);
  const str = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, (m2, idx, full) => (idx === full.indexOf(' ') ? ' ' : m2));
  return str.replace(/^0/, '');
};

function pToc(m, no, toc) {
  const rows = toc.map(([t, pg], i) => `<div style="display:flex;align-items:baseline;gap:18px;padding:15px 0;border-bottom:1px solid #ECE8F5;font-size:19px;font-weight:700"><span style="color:#B03F6B;width:38px;font-weight:800">${String(i + 1).padStart(2, '0')}</span>${E(t)}<span style="margin-left:auto;font-weight:500;color:#6B7280;font-size:15px">${pg}</span></div>`).join('');
  const tipPg = toc.find(([t]) => t === 'Your snapshot');
  const tip = `<div style="position:absolute;left:80px;right:80px;bottom:60px;background:#F1EEFB;border-radius:14px;padding:16px 20px;font-size:14px;line-height:1.6"><b>Tip:</b> You do not have to read it all at once.${tipPg ? ` Start with your snapshot on page ${tipPg[1]}, then jump to the page that catches your eye.` : ''}</div>`;
  // NOTE: the kit's own source has '100%%' here (a Python %-format escape that, due to operator precedence, is never
  // actually run through %-interpolation in generate.py - so the kit's real output literally contains double percent
  // signs, not a typo this port should "fix"). Kept verbatim for byte-fidelity with the kit's actual output.
  const inner = `<div style="position:absolute;left:0;top:0;width:250px;height:230px;background:#F2B79A;clip-path:polygon(0 0,100%% 0,0 100%%)"></div>${logo('#1E2350', '#F2B79A')}<h1 style="position:absolute;left:80px;top:130px;margin:0;font-size:46px;font-weight:800">CONTENTS</h1><div style="position:absolute;left:80px;right:80px;top:250px">${rows}</div>${tip}`;
  return page(m, inner, no);
}

function pAreas(m, no) {
  const DOM = require('./rules').DOM;
  const tops = { A: 262, B: 498, C: 732 };
  const blocks = ['A', 'B', 'C'].map((cid) => {
    const c = C.CLUSTER[cid]; const doms = ORDER.filter((k) => DOM[k].cluster === cid);
    const items = doms.map((k) => `<div style="display:flex;gap:14px;align-items:center"><div style="width:46px;height:46px;flex-shrink:0;border-radius:50%;background:#fff;border:1.5px solid #D9D4EE;display:flex;align-items:center;justify-content:center">${icon(k, c.fg)}</div><div><b style="font-size:15px">${E(DOM[k].name)}</b><span style="font-size:14px;line-height:1.5;display:block;color:#2E3470">${E(DOM[k].meaning)}</span></div></div>`).join('');
    const badge = `<div style="width:130px;flex-shrink:0;text-align:center"><div style="width:84px;height:84px;margin:0 auto;border-radius:50%;background:${c.badge};display:flex;align-items:center;justify-content:center"><svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="${c.fg}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${C.CLUSTER_ICON[cid]}</svg></div><div style="font-weight:800;color:${c.fg};font-size:15px;margin-top:8px;line-height:1.2">${E(c.name)}</div></div>`;
    return `<div style="position:absolute;left:52px;right:52px;top:${tops[cid]}px;background:${c.bg};border-radius:22px;padding:22px 24px;display:flex;gap:22px;align-items:center">${badge}<div style="border-left:1.5px dashed ${c.dash};padding-left:20px;display:flex;flex-direction:column;gap:13px">${items}</div></div>`;
  }).join('');
  const inner = `<div style="position:absolute;left:0;bottom:0;width:794px;height:120px;background:linear-gradient(90deg,#F0D9A8,#F6E9C2);clip-path:polygon(0 60%,100% 0,100% 100%,0 100%)"></div>${logo()}<h1 style="position:absolute;left:64px;top:96px;margin:0;font-size:54px;font-weight:300;line-height:1.02">YOUR SEVEN CAPABILITIES</h1><p style="position:absolute;left:64px;right:64px;top:170px;margin:0;font-size:19px;line-height:1.5;color:#2E3470">Santulan means balance. Your report looks at seven capabilities, grouped into three clusters that work together.</p>${blocks}`;
  return page(m, inner, no);
}

const STATUS = { MS01: 'Complete', MS02: 'Early estimate', MS03: 'Not enough data yet', MS04: 'Not enough data yet' };

function pSnapshot(m, no) {
  const DOM = require('./rules').DOM;
  const rows = ORDER.map((k) => `<tr><td>${E(DOM[k].name)}</td><td style="width:90px">${m.d[k].scored ? pyFixed(m.d[k].mean, 1) : '–'}</td><td style="width:170px">${E(STATUS[m.d[k].state])}</td></tr>`).join('');
  const cards = ['<div class="card" style="background:#F1EEFB"><b class="k" style="color:#5A4BA8">The dots</b><div>Each dot is the average of your answers in one capability. Further out means a higher average.</div></div>'];
  const early = ORDER.filter((k) => m.d[k].state === 'MS02');
  const none = ORDER.filter((k) => !m.d[k].scored);
  if (early.length) {
    const names = early.map((k) => `${DOM[k].name} (${Math.round((1 - m.d[k].share) * 100)}% answered)`).join(', ');
    cards.push(`<div class="card" style="background:#FCF1D4"><b class="k" style="color:#7A4A00">Early estimates</b><div>${E(names)} had a few skipped answers, so treat ${early.length === 1 ? 'it' : 'them'} as a first look.</div></div>`);
  }
  if (none.length) {
    const names = none.map((k) => DOM[k].name).join(', ');
    cards.push(`<div class="card" style="background:#EEF0F4"><b class="k" style="color:#374151">Dashed line</b><div>Not enough answers yet in ${E(names)}. That is not a low score, just not enough data yet.</div></div>`);
  }
  const cols = cards.length;
  const inner = `<div style="position:absolute;left:0;top:0;width:160px;height:300px;background:#E5E2F6;clip-path:polygon(0 0,100% 0,30% 100%,0 100%)"></div><div style="position:absolute;right:0;top:0;bottom:0;width:12px;background:#F0C94D"></div>${logo()}`
    + `<div style="position:absolute;left:64px;top:96px;font-size:13px;font-weight:800;letter-spacing:.08em;color:#2E4A7A">YOUR CAPABILITY SNAPSHOT</div><h1 style="position:absolute;left:64px;top:118px;margin:0;font-size:40px;font-weight:800;line-height:1.05">Your seven capabilities<br>at a glance</h1>`
    + `<div style="position:absolute;left:152px;top:214px">${radarSvg(m)}</div>`
    + `<p style="position:absolute;left:100px;right:100px;top:566px;margin:0;text-align:center;font-size:14px;font-style:italic;line-height:1.45;color:#2E3470">Scores are averages on a 1&ndash;5 scale and are not directly comparable between capabilities. Compare your own future results, not one capability with another.</p>`
    + `<div style="position:absolute;left:64px;right:76px;top:632px"><table class="snap"><thead><tr><th>Capability</th><th>Average</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`
    + `<div style="position:absolute;left:64px;right:76px;top:876px;display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:14px">${cards.join('')}</div>`;
  return page(m, inner, no);
}

function bubbleRow(k, title, body, color, bgc, border = false) {
  const left = border ? `border-left:5px solid ${color};padding-left:20px` : '';
  return `<div style="display:flex;gap:24px;align-items:flex-start"><div style="width:96px;height:96px;flex-shrink:0;border-radius:50%;background:${bgc};display:flex;align-items:center;justify-content:center">${icon(k, cl(k).fg, 50)}</div><div style="${left}"><h3 style="margin:0;font-size:22px;font-weight:800;color:${color}">${E(title)}</h3><p style="margin:6px 0 0;font-size:16px;line-height:1.6">${E(body)}</p></div></div>`;
}

const firstSentence = (t) => t.split(/(?<=\.)\s/)[0];

function pat(m, k) {
  const b = m.d[k].band;
  return m.d1 ? C.DOM[k].d1[b] : C.DOM[k].pattern[b];
}

function pStrengths(m, no) {
  const DOM = require('./rules').DOM;
  const rows = m.strengths.map((k) => bubbleRow(k, DOM[k].strength_title, firstSentence(pat(m, k)), cl(k).fg, cl(k).bg)).join('');
  const inner = `${logo()}<h1 style="position:absolute;left:64px;top:110px;margin:0;font-size:56px;font-weight:800;line-height:1.02">Your starting<br>strengths</h1>${read('assets/strength_person.svg')}`
    + `<p style="position:absolute;left:64px;right:290px;top:258px;margin:0;font-size:15px;line-height:1.6;color:#2E3470">These are places where your answers suggest a good base to build on. They are shown in the same fixed order as the rest of your report, not ranked.</p>`
    + `<div style="position:absolute;left:64px;right:64px;top:360px;display:flex;flex-direction:column;gap:38px">${rows}</div>`;
  return page(m, inner, no);
}

function pExplore(m, no) {
  const rows = m.explore.map((k) => bubbleRow(k, require('./rules').DOM[k].explore_title, `Your responses suggest this may be a useful capability to explore. ${C.DOM[k].about}`, '#B03F6B', cl(k).bg, true)).join('');
  const nxt = m.rel.action ? 'You will find simple things to try for these in your growth plan.' : 'You can read more about each one in the capability-by-capability pages, and talk it through with a counsellor or someone you trust.';
  const inner = `<div style="position:absolute;left:0;top:0;width:150px;height:280px;background:#D7DEC2;clip-path:polygon(0 0,100% 0,0 100%)"></div><div style="position:absolute;left:0;bottom:0;width:794px;height:130px;background:linear-gradient(90deg,#F2D2A5,#F1E4A8);clip-path:polygon(0 55%,100% 0,100% 100%,0 100%)"></div>${logo()}${read('assets/explore_person.svg')}`
    + `<h1 style="position:absolute;left:330px;top:130px;margin:0;font-size:44px;font-weight:800;line-height:1.08">Capabilities<br>worth exploring</h1>`
    + `<p style="position:absolute;left:64px;right:64px;top:352px;margin:0;font-size:16px;line-height:1.6;color:#2E3470">Every capability can keep developing. These came out as good places to start. They are not weaknesses, and they do not say what you can or cannot do.</p>`
    + `<div style="position:absolute;left:64px;right:64px;top:448px;display:flex;flex-direction:column;gap:36px">${rows}</div>`
    + `<div style="position:absolute;left:64px;right:64px;top:900px;background:#F1EEFB;border-radius:14px;padding:16px 20px;font-size:14px;line-height:1.6"><b>Good to know:</b> ${E(nxt)}</div>`;
  return page(m, inner, no);
}

function blockHtml(m, k) {
  const DOM = require('./rules').DOM;
  const d = m.d[k];
  let chips; let h;
  if (d.scored) {
    chips = `<span class="chip">Average ${pyFixed(d.mean, 1)}</span>${d.state === 'MS02' ? '<span class="chip e">Early estimate</span>' : ''}`;
    h = `<div class="lb">WHAT YOUR ANSWERS SUGGEST</div><p>${E(pat(m, k))}${d.state === 'MS02' ? ' A few answers were skipped, so treat this as a first look.' : ''}</p>`;
    h += `<div class="lb q">ASK YOURSELF</div><p>${E(C.DOM[k].ask)}</p>`;
    if (m.rel.action) h += `<div class="lb t">TRY THIS</div><p>${E(C.DOM[k].steps[0])}</p>`;
  } else {
    chips = '<span class="chip g">Not enough data yet</span>';
    h = `<p>You answered ${require('./rules').pctPhrase(d.share)} of this capability, which is not enough for us to describe it fairly. This is not a low score. You can finish the remaining answers whenever you are ready.</p>`;
  }
  return `<div class="blk"><div class="hd"><h3>${E(DOM[k].name)}</h3>${chips}</div><div class="sub">${E(DOM[k].meaning)}</div>${h}</div>`;
}

/** Greedy pagination by measured height (REN-11); never exceeds the page, never splits a block.
 *  `measure(htmlBlocks: string[]) => Promise<number[]>` is injected (a real browser measures rendered height - see
 *  renderer.js). Async because Playwright's page.evaluate() is async - generate.py's own Measurer is sync only because
 *  Python's Playwright API offers a sync_api variant; there is no Node equivalent, so this had to become async here. */
async function packDetails(m, measure) {
  const avail = 1123 - 100 - 200;
  const hs = await measure(ORDER.map((k) => blockHtml(m, k)));
  const pages = []; let cur = []; let used = 0;
  ORDER.forEach((k, idx) => {
    const h = hs[idx];
    let need = h + (cur.length ? 30 : 0);
    if (cur.length && (used + need > avail || cur.length >= CFG['CFG-24'])) {
      pages.push(cur); cur = []; used = 0; need = h;
    }
    cur.push(k); used += need;
  });
  if (cur.length) pages.push(cur);
  return pages;
}

function pDetail(m, no, keys, first) {
  const title = first ? 'Your capabilities, in more detail' : 'Your capabilities, continued';
  const inner = `${logo()}<div style="position:absolute;left:64px;right:64px;top:84px;display:flex;align-items:center;gap:14px"><div style="font-size:14px;font-weight:800;border-bottom:2px solid #1E2350;padding-bottom:3px">Capability by capability</div></div>`
    + `<h1 style="position:absolute;left:64px;top:126px;margin:0;font-size:42px;font-weight:800;color:#3E6AA8">${title}</h1><div style="position:absolute;left:64px;right:64px;top:196px">${keys.map((k) => blockHtml(m, k)).join('')}</div>`;
  return page(m, inner, no, 'background:linear-gradient(160deg,#FFFFFF 0%,#F3F0FB 100%)');
}

function pFocus(m, no) {
  const DOM = require('./rules').DOM;
  const sel = m.goals.map((g) => `<li>${E(g)}</li>`).join('');
  const sup = []; const grow = []; const unl = [];
  for (const g of m.goals) {
    for (const [k, why] of C.GOALS[g] || []) {
      const d = m.d[k];
      const item = [k, g, why];
      if (d.scored && d.raw >= require('./rules').BAND_LOW) sup.push(item);
      else if (d.scored) grow.push(item);
      else unl.push(item);
    }
  }
  const lst = (items, unlMode = false) => {
    const out = [];
    for (const k of ORDER) {
      for (const [kk, g, why] of items) {
        if (kk !== k) continue;
        if (unlMode) out.push(`<li><b>${E(DOM[k].name)}</b> links to <i>${E(g.toLowerCase())}</i>. We need the rest of your answers in this capability before we can say more.</li>`);
        else out.push(`<li><b>${E(DOM[k].name)}:</b> ${E(why)} <i>(${E(g.toLowerCase())})</i></li>`);
      }
    }
    return out.join('');
  };
  const sec = (color, bgc, ttl, body, svgpath) => {
    if (!body) return '';
    return `<div style="display:flex;gap:24px;align-items:flex-start"><div style="width:92px;height:92px;flex-shrink:0;border-radius:50%;background:${bgc};display:flex;align-items:center;justify-content:center"><svg width="46" height="46" viewBox="0 0 46 46" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgpath}</svg></div><div><h3 style="margin:0;font-size:21px;font-weight:800;color:${color}">${ttl}</h3><ul style="margin:6px 0 0;padding-left:20px;font-size:15px;line-height:1.55">${body}</ul></div></div>`;
  };
  const body = sec('#3E6AA8', '#E8EEFB', 'Focus areas you selected', sel, '<circle cx="23" cy="23" r="17"/><circle cx="23" cy="23" r="9"/><circle cx="23" cy="23" r="2" fill="#3E6AA8"/>')
    + sec('#8A5A00', '#FCF1D4', 'Capabilities that can support your focus', lst(sup), '<path d="M6 36c8-16 14 8 20-6s8-10 14-20M32 10h8v8"/>')
    + sec('#5A4BA8', '#F1EEFB', 'Capabilities you can keep growing for these goals', lst(grow), '<circle cx="23" cy="23" r="17"/><path d="M23 12v11l7 4"/>')
    + sec('#374151', '#EEF0F4', 'Still to unlock', lst(unl, true), '<path d="M23 4l5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1z" stroke-dasharray="4 4"/>');
  const inner = `<div style="position:absolute;right:0;top:100px;bottom:200px;width:8px;background:#EBD97A"></div><div style="position:absolute;left:0;bottom:0;width:794px;height:110px;background:linear-gradient(90deg,#F0D9A8,#F6E9C2);clip-path:polygon(0 60%,100% 0,100% 100%,0 100%)"></div>${logo()}`
    + `<h1 style="position:absolute;left:64px;top:96px;margin:0;font-size:44px;font-weight:800;line-height:1.05">How does this connect<br>to your focus areas?</h1>`
    + `<p style="position:absolute;left:64px;right:64px;top:210px;margin:0;font-size:16px;line-height:1.6;color:#2E3470">Knowing yourself better helps you make confident choices and use your strengths on the things you care about. Here is how your report links to the goals you picked.</p>`
    + `<div style="position:absolute;left:64px;right:64px;top:300px;display:flex;flex-direction:column;gap:24px">${body}<div style="display:flex;margin:6px 6px 0"><div style="width:6px;background:#1E2350"></div><div style="flex-grow:1;padding:12px 22px;font-size:14.5px;line-height:1.55"><b>Applying your capability profile</b><br>These links are ideas, not rules. Notice which ones feel true for you, and use them to choose where to put your effort.</div><div style="width:6px;background:#1E2350"></div></div></div>`;
  return page(m, inner, no);
}

function pPlan(m, no, k, idx, total, hero, checkin) {
  const DOM = require('./rules').DOM;
  const c = C.DOM[k]; const steps = c.steps;
  const showSteps = m.rel.action;
  let cards = '';
  if (showSteps) {
    cards = C.STEP_TAGS.map(([tag, mins, fg, bg], i) => `<div style="border-radius:18px;padding:18px 18px 16px;background:${bg}"><div style="font-size:12px;font-weight:800;letter-spacing:.08em;color:${fg}">${tag}</div><p style="margin:8px 0 0;font-size:14.5px;line-height:1.5">${E(steps[i])}</p><div style="font-size:13px;margin-top:10px;font-weight:600;color:${fg}">${mins}</div></div>`).join('');
    cards = `<div style="margin-top:20px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">${cards}</div><div style="font-size:14px;margin-top:12px;color:#4B5563">You begin at Step 1 and move on when it feels easy. There is no rush.</div>`;
  }
  let ift = '';
  if (m.rel.ifthen) {
    const [a, b] = c.ifthen;
    ift = `<div style="margin-top:22px;padding:18px 24px;border:2.5px dashed #5A4BA8;border-radius:18px;background:#FBFAFF"><div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#5A4BA8">MY IF&ndash;THEN PLAN (EDIT IT ANY TIME)</div><div style="font-size:20px;line-height:1.5;margin-top:8px"><b style="color:#B03F6B">IF</b> ${E(a)}, <b style="color:#B03F6B">THEN</b> ${E(b)}.</div></div>`;
  }
  let chk = '';
  if (checkin) {
    const rd0 = new Date(`${m.s.assessment_date}T00:00:00`);
    rd0.setDate(rd0.getDate() + CFG['CFG-05']);
    const rd = fmtDate(rd0.toISOString().slice(0, 10));
    const wk = Array.from({ length: 4 }, (_, i) => `<div style="border:1.5px solid #D9D4EE;border-radius:12px;padding:10px 12px;height:64px;font-size:12px;font-weight:800;color:#5A4BA8;letter-spacing:.06em">WEEK ${i + 1}</div>`).join('');
    const qa = [['What happened?', 'What did I try, and how often?'], ['What got in the way?', 'What made it hard, or easy?'], ['What did I learn?', 'What surprised me about myself?'], ['What will I change?', 'What will I keep, drop or try next?']];
    const qs = qa.map(([a, b]) => `<div style="background:#F1EEFB;border-radius:14px;padding:12px 16px;font-size:14px;line-height:1.45"><b style="display:block;color:#5A4BA8;font-size:14px;margin-bottom:2px">${a}</b>${b}</div>`).join('');
    chk = `<div style="margin-top:22px"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0;font-size:26px;font-weight:800">My 30-day check-in</h2><div style="font-size:14px;color:#4B5563">Review date: <b>${rd}</b></div></div><div style="height:4px;background:#7C6BD0;border-radius:2px;margin:8px 0 12px"></div>`
      + `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${wk}</div><div style="font-size:14px;color:#4B5563;margin-top:6px">Tick or jot a word each time you try your step.</div><div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${qs}</div>`
      + `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#2E3470">Your notes are private to you and are never scored. The check-in is a chance to learn, not a test.</p></div>`;
  }
  let head; let top = 100;
  if (hero) {
    head = `<div style="position:absolute;left:0;top:0;width:794px;height:300px;background:linear-gradient(150deg,#8F86D8 0%,#5A4BA8 100%);clip-path:polygon(0 0,100% 0,100% 78%,0 100%)"></div>${logo('#FFFFFF', '#5A4BA8')}`
      + `<div style="position:absolute;left:64px;top:92px;color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.1em">YOUR 30-DAY CAPABILITY PLAN</div><h1 style="margin:8px 0 0;font-size:46px;font-weight:300;line-height:1.05">Your plan,<br>in your words</h1><p style="margin:10px 0 0;font-size:15px;max-width:520px;line-height:1.5">You chose these. Small and doable beats big and perfect. You can change anything on these pages.</p></div>`;
    top = 330;
  } else {
    head = logo();
  }
  const inner = `${head}<div style="position:absolute;left:64px;right:64px;top:${top}px"><div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#5A4BA8">PRIORITY ${idx}</div><h2 style="margin:6px 0 0;font-size:28px;font-weight:800;line-height:1.15">${E(DOM[k].explore_title)}</h2><div style="font-size:14px;color:#4B5563;margin-top:4px">From the capability ${E(DOM[k].name)}</div>${cards}${ift}${chk}</div>`;
  return page(m, inner, no);
}

function pChange(m, no) {
  const DOM = require('./rules').DOM;
  const { msState, CHANGE_EPS } = require('./rules');
  const rows = [];
  for (const k of ORDER) {
    const a = m.d[k]; const pv = m.prev.domains && m.prev.domains[k];
    if (!pv) continue;
    const ps = 1 - pv.answered / pv.total;
    if (a.scored && ['MS01', 'MS02'].includes(msState(Math.round(ps * 1e6) / 1e6))) {
      const dv = Math.round((a.raw - pv.mean) * 10) / 10;
      const word = Math.abs(dv) < CHANGE_EPS ? 'about the same' : (dv < 0.6 && dv > 0 ? 'a little higher' : dv > -0.6 && dv < 0 ? 'a little lower' : dv > 0 ? 'higher' : 'lower');
      rows.push(`<tr><td>${E(DOM[k].name)}</td><td>${pyFixed(pv.mean, 1)}</td><td>${pyFixed(a.raw, 1)}</td><td>${word}</td></tr>`);
    } else {
      rows.push(`<tr><td>${E(DOM[k].name)}</td><td>–</td><td>–</td><td>Not enough data to compare</td></tr>`);
    }
  }
  const inner = `${logo()}<h1 style="position:absolute;left:64px;top:110px;margin:0;font-size:46px;font-weight:800">What changed<br>since last time</h1>`
    + `<p style="position:absolute;left:64px;right:64px;top:250px;margin:0;font-size:16px;line-height:1.6;color:#2E3470">You took the questionnaire before, on ${E(fmtDate(m.prev.date))}. Here is how your answers in each capability compare. Each row is about one capability only.</p>`
    + `<div style="position:absolute;left:64px;right:64px;top:340px"><table class="snap"><thead><tr><th>Capability</th><th>Before</th><th>Now</th><th>What it looks like</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    + `<div style="position:absolute;left:64px;right:64px;top:700px;background:#F1EEFB;border-radius:14px;padding:16px 20px;font-size:14px;line-height:1.6"><b>Please remember:</b> small differences can come from how an ordinary day went, not from real change. Look at the direction over several check-ins, not at one number.</div>`;
  return page(m, inner, no);
}

function pRoadmap(m, no) {
  let hero; let s3;
  if (m.rel.action) {
    hero = `Your next steps are simple. Try the plan you chose, and check in after ${CFG['CFG-05']} days.`;
    s3 = ['Try your plan', `Spend up to ${CFG['CFG-05']} days trying one small step at a time.`];
  } else {
    hero = 'Your next steps are simple. Read through your capabilities, and talk them over with someone you trust.';
    s3 = ['Talk it through', 'Share your snapshot with a counsellor, teacher or someone you trust.'];
  }
  const rev = m.rel.review
    ? `<b>Step 4 &middot; Review.</b> After ${CFG['CFG-05']} days, check in on what happened. Later, you can take the questionnaire again to see how things are changing. It is a journey, and small, steady steps count.`
    : '<b>Step 4 &middot; Review.</b> Later, you can take the questionnaire again to see how things are changing. It is a journey, and small, steady steps count.';
  const step = (x, y, ico, n, ttl, txt) => `<div style="position:absolute;width:190px;left:${x}px;top:${y}px"><div style="width:96px;height:96px;border-radius:50%;background:#E5E2F6;display:flex;align-items:center;justify-content:center"><svg width="46" height="46" viewBox="0 0 46 46" fill="none" stroke="#5A4BA8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico}</svg></div><h4 style="margin:8px 0 0;font-size:19px;font-weight:800">Step ${n}</h4><div style="font-size:15px;color:#4B5563">${ttl}</div><p style="margin:6px 0 0;font-size:14px;line-height:1.5">${txt}</p></div>`;
  const inner = `<svg viewBox="0 0 794 1123" width="794" height="1123" style="position:absolute;left:0;top:0" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9C93DA"/><stop offset="1" stop-color="#C6B6E2"/></linearGradient></defs><path d="M0 0H794V420H700V470H620V540H540V610H460V680H380V760H300V830H220V900H120V960H0Z" fill="url(#g)"/></svg>${logo()}`
    + `<h1 style="position:absolute;left:0;right:0;top:100px;margin:0;text-align:center;font-size:48px;font-weight:800;line-height:1.08">Roadmap of your<br>Santulan journey</h1>${read('assets/roadmap_person.svg')}`
    + `<div style="position:absolute;left:64px;top:300px;width:400px;background:rgba(255,255,255,.86);border-radius:22px;padding:22px 24px;font-size:15px;line-height:1.6">${E(hero)} If you want company on the way, your school counsellor can go through this report with you. You can also ask for a conversation with a trained professional at any time.</div>`
    + step(64, 740, '<rect x="9" y="7" width="28" height="34" rx="4"/><path d="M16 17l3 3 5-6M16 29h14"/>', 1, 'Answer', 'You completed the questionnaire about your thoughts, feelings and habits.')
    + step(302, 646, '<circle cx="23" cy="15" r="8"/><path d="M8 40c0-8 7-13 15-13s15 5 15 13"/>', 2, 'See your profile', 'You read your snapshot. <b>You are here.</b>')
    + step(540, 552, '<path d="M6 36l10-12 8 6 10-16 6 6"/><path d="M34 14h10v10"/>', 3, s3[0], s3[1])
    + `<div style="position:absolute;left:64px;right:64px;top:1010px;background:#fff;border:1.5px solid #E5E2F6;border-radius:16px;padding:14px 20px;font-size:14px;line-height:1.55">${rev}</div>`;
  return page(m, inner, no);
}

const pClosing = (m, no) => staticPage(m, 'closing', no, '#1E2350');

function pHold(m, no) {
  const inner = `<div style="position:absolute;left:0;right:0;top:0;height:140px;background:#FAF8F3"></div>${logo()}`
    + `<div style="position:absolute;left:96px;top:250px;max-width:600px"><div style="width:64px;height:64px;border-radius:50%;background:#E6F1FB;display:flex;align-items:center;justify-content:center;color:#0C447C;font-family:Fraunces,Georgia,serif;font-size:34px;font-weight:600">&hellip;</div>`
    + `<h1 style="font-family:Fraunces,Georgia,serif;font-weight:600;font-size:40px;line-height:1.15;margin:24px 0 0">Your responses are being reviewed</h1>`
    + `<p style="font-size:19px;line-height:1.6;color:#374151;margin:18px 0 0">Thank you for completing your answers. We are taking a little more time before we share your report. There is nothing you need to do right now.</p>`
    + `<p style="font-size:17px;line-height:1.6;color:#4B5563;margin:14px 0 0">If you have questions, you can ask your school contact or counsellor.</p></div>`;
  return page(m, inner, no, 'background:#FAF8F3', false);
}

function pInvalid(m, no) {
  const inner = `${logo()}<div style="position:absolute;left:96px;top:250px;max-width:600px"><h1 style="font-family:Fraunces,Georgia,serif;font-weight:600;font-size:40px;line-height:1.15;margin:0">We could not process this attempt</h1>`
    + `<p style="font-size:19px;line-height:1.6;color:#374151;margin:18px 0 0">Something about this attempt means we are not able to prepare a report from it. Please speak to your school contact, who can help you with the next step.</p></div>`;
  return page(m, inner, no, 'background:#FAF8F3', false);
}

// ---------------------------------------------------------------------------------------------------------- assembly
/** Which pages appear, in order, with their TOC title (null = not in TOC). Show-conditions mirror the kit's sheet 27. */
function planPages(m) {
  if (m.status === 'hold') return [['hold', null]];
  if (m.status === 'invalid') return [['invalid', null]];
  const L = [['cover', null], ['intro', 'What is capability development?'], ['hello', null], ['toc', null], ['areas', 'Your seven capabilities'], ['snapshot', 'Your capability snapshot']];
  if (m.strengths.length) L.push(['strengths', 'Your starting strengths']);
  if (m.explore.length) L.push(['explore', 'Capabilities worth exploring']);
  L.push(['details', 'Capability by capability']); // expands to N pages
  if (m.prev && m.prev.domains) L.push(['change', 'What changed since last time']);
  if (m.rel.priority && m.goals.length) L.push(['focus', 'How this connects to your focus areas']);
  if (m.rel.action && m.rel.ifthen && m.plan.length) L.push(['plans', 'Your 30-day capability plan']);
  L.push(['roadmap', 'Your roadmap and what comes next'], ['closing', null]);
  return L;
}

async function build(m, measure) {
  const plist = planPages(m); const pagesMeta = [];
  for (const [kind, ttl] of plist) {
    if (kind === 'details') {
      (await packDetails(m, measure)).forEach((keys, i) => pagesMeta.push(['detail', [keys, i === 0], i === 0 ? ttl : null]));
    } else if (kind === 'plans') {
      m.plan.forEach((k, i) => pagesMeta.push(['plan', [k, i + 1, i === 0, i === m.plan.length - 1 && m.rel.review], i === 0 ? ttl : null]));
    } else {
      pagesMeta.push([kind, null, ttl]);
    }
  }
  const toc = pagesMeta.map(([, , t], i) => (t ? [t, i + 1] : null)).filter(Boolean);
  const out = [];
  pagesMeta.forEach(([kind, arg], i) => {
    const no = i + 1;
    if (kind === 'cover') out.push(coverPage(m));
    else if (kind === 'intro') out.push(staticPage(m, 'intro', no));
    else if (kind === 'hello') out.push(staticPage(m, 'hello', no));
    else if (kind === 'toc') out.push(pToc(m, no, toc));
    else if (kind === 'areas') out.push(pAreas(m, no));
    else if (kind === 'snapshot') out.push(pSnapshot(m, no));
    else if (kind === 'strengths') out.push(pStrengths(m, no));
    else if (kind === 'explore') out.push(pExplore(m, no));
    else if (kind === 'detail') out.push(pDetail(m, no, arg[0], arg[1]));
    else if (kind === 'change') out.push(pChange(m, no));
    else if (kind === 'focus') out.push(pFocus(m, no));
    else if (kind === 'plan') out.push(pPlan(m, no, arg[0], arg[1], m.plan.length, arg[2], arg[3]));
    else if (kind === 'roadmap') out.push(pRoadmap(m, no));
    else if (kind === 'closing') out.push(pClosing(m, no));
    else if (kind === 'hold') out.push(pHold(m, no));
    else if (kind === 'invalid') out.push(pInvalid(m, no));
  });
  return [out, pagesMeta.map(([kind]) => kind)];
}

function coverPage(m) {
  let t = read('static/cover.html');
  t = t.replace('{{DISPLAY}}', E(m.s.display_name))
    .replace('{{AGECLASS}}', E(m.s.age) + (m.s.class ? ` &middot; ${E(m.s.class)}` : ''))
    .replace('{{DATE}}', E(fmtDate(m.s.assessment_date)))
    .replace('{{REPORTID}}', E(m.s.report_id));
  return m.draft ? `${t.trimEnd().slice(0, -6)}${draftTag(m)}</div>` : t;
}

function staticPage(m, name, no, fcolor = null) {
  let t = read(`static/${name}.html`);
  t = t.replace('{{FOOTER}}', footer(m, no, fcolor)).replace('{{FIRST}}', E(m.first));
  return m.draft ? `${t.trimEnd().slice(0, -6)}${draftTag(m)}</div>` : t;
}

function document(m, pages) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Santulan Development Report - ${E(m.s.display_name)}</title>${FONTS}<style>${CSS}</style></head><body>${pages.join('')}</body></html>`;
}

module.exports = {
  E, FONTS, CSS, logo, footer, draftTag, page, icon, cl, radarSvg, fmtDate,
  planPages, build, document, packDetails, blockHtml,
  pToc, pAreas, pSnapshot, pStrengths, pExplore, pRoadmap, coverPage, staticPage, pClosing, pFocus, pPlan, pChange, pHold, pInvalid,
};
