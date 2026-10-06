/*
 * Ported from the Santulan pilot kit 2's santulan_gen/cohort_report.py: the page functions (final v1.2 definitions - where the
 * Python file defines a page function more than once, the last definition is the one that runs, and is the one ported here),
 * build() and document(). Every '%.Nf' / round() goes through pyFixed/pyRound so ties round like Python.
 */
const { pyFixed, pyRound } = require('../../../utils/pyNumber');
const P = require('../pilotReport/pages');
const C = require('../pilotReport/content');
const { DOM, ORDER } = require('../pilotReport/rules');
const M = require('./cohortModel');

const { E, FONTS, CSS, logo, icon } = P;
const { COHORT, MINN, CFG, BAND_LABEL, MEANING, RELEASE_SUB, SUB_MIN_ANSWERED, SUB_DELTA, BAND_GAP, EVIDENCE_STATUS, REPORT_VERSION, median } = M;
void CFG;
const Ef = (s) => E(s);
const f1 = (x) => pyFixed(x, 1);
const f0 = (x) => pyFixed(x, 0);
const rnd = (x) => pyRound(x, 0);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const hide = (n) => (n < MINN ? `fewer than ${MINN}` : String(n));
const fdate = (d) => `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const clusterOf = (k) => C.CLUSTER[DOM[k].cluster];

const CAPTION = 'Scores are averages on a 1–5 scale and are not directly comparable between capabilities. Compare your own future results, not one capability with another.';
const SPREAD = { CLOSE: 0.8, WIDE: 1.2 };
const COVER_CARE = 0.80;
const OPAQ = { 1: 0.28, 2: 0.5, 3: 0.75, 4: 1.0 };
const ANCHORS = ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'];
const HELPLINE_TELEMANAS_VERIFIED = '5 Oct 2026 (Press Information Bureau)';
const PILOT_THRESHOLDS = [
  ['Smallest group shown', '10 students', 'OD-18, proposed'],
  ['Missing answers: Early estimate / Not enough data yet', 'under 20% / 20% or more', 'CFG-01, pilot scoring rule, subject to psychometric review'],
  ['Fewest questions for a capability number', '5 questions', 'OD-17, proposed'],
  ['Sub-area number for a student', 'at least 2 questions answered', 'OD-24, proposed'],
  ['Sub-area shown', '10 or more students with a number', 'OD-24, proposed'],
  ['Sub-area pattern flag', '0.3 points from the capability average', 'OD-24, provisional, not a validated threshold'],
  ['Read with extra care (data coverage)', 'fewer than 80% of students have a number', 'OD-24, proposed'],
  ['Middle half “spans widely”', '1.2 points or more', 'OD-24, proposed'],
  ['Mostly the two ends / mostly the middle', '70% / 60% of a capability’s answers', 'OD-19, pilot thresholds'],
  ['Same answer all through', '90% in one end, at least 10 questions', 'CFG-06 and CFG-07'],
];
const EXTRA_CSS = '.cb{border:1.5px solid #E5E1F7;border-radius:16px;padding:12px 16px;overflow:hidden;background:#fff}.cb h3{margin:0}';

const IDEAS = {
  C1: [['Look at the school day for rest, movement and water breaks.', 'Talk with students about sleep, screens and energy, without judging.', 'Show simple ways to settle the body before a big day.'],
    ['When do students here seem most tired or restless?', 'Who could ask students what helps their body feel ready to learn?']],
  C2: [['Start the day or the class with a short feelings check-in.', 'Give students words for feelings, for example a feelings chart.', 'Make sure every student can name a trusted adult.'],
    ['Do students know whom to go to when they feel upset?', 'How do staff respond when a student shows strong feelings?']],
  C3: [['Use mixed-group projects with clear roles.', 'Practise listening and respectful disagreement in class circles.', 'Look at how new or quiet students are welcomed.'],
    ['Where do students work well together, and where do groups struggle?', 'Which students may find it hard to join in, and how could we ask them?']],
  C4: [['Give time to reflect: what I enjoy, what I am learning about myself.', 'Let students show their interests through clubs, projects and talks.', 'Notice and name effort and growth, not only results.'],
    ['Where do students get to show who they are?', 'Do all students see themselves in school life?']],
  C5: [['Invite alumni and community members to share their paths.', 'Help students set small goals linked to what matters to them.', 'Connect school subjects to real purposes outside school.'],
    ['How often do students talk about what matters to them?', 'What real choices do students get to make?']],
  C6: [['Talk openly about setbacks and how staff handle change.', 'Practise a simple routine: what happened, what can I try next.', 'Plan extra support around big changes, such as new classes or term breaks.'],
    ['What changes are students facing this year?', 'How do we support a student after a setback?']],
  C7: [['Show how to break big tasks into steps with dates.', 'Give students some choice in how they show their learning.', 'Help students notice what helps them start and focus.'],
    ['Where do students plan their own work?', 'What gets in the way of starting or finishing?']],
};

const GLOSS = [
  ['Capability', 'A developable pattern of awareness, understanding, regulation, relationships and purposeful action. There are seven.'],
  ['Self-rating and average', 'Students rate statements about themselves from 1 to 5. The average is the mean of those ratings. It shows how students see themselves, not what they can do.'],
  ['Middle half', 'The range that holds the middle half of the students. A quarter are below it and a quarter above it.'],
  ['Cohort', 'The group of students whose answers are put together in this report.'],
  ['Complete, Early estimate, Not enough data yet', 'How many answers a student gave in a capability. Only Complete and Early estimate give a number.'],
  ['Data coverage', 'How many students have a usable number. It is not the same as how accurate the numbers are.'],
  ['Response pattern', 'How students used the answer scale, for example mostly the middle. It is not a judgement of the student.'],
  ['Sharing grant', 'The institution’s agreement that lets this report be shared with named roles.'],
];

// ---------------------------------------------------------------------------------------------------- shared pieces
function tagsHtml(m) {
  let tags = m.draft ? '<div class="draft">DRAFT &middot; content pending review</div>' : '';
  if (m.sample) tags += '<div class="draft" style="top:54px;background:#E5E1F7;border-color:#3C3489;color:#3C3489">SAMPLE &middot; made-up students</div>';
  return tags;
}
function frame(m, inner, no, topLogo = true) {
  const foot = `<div class="ft"><span>${E(m.inst_name)} &middot; ${E(m.report_id)}</span><span>Page ${no}</span></div>`;
  return `<section class="p">${tagsHtml(m)}${topLogo ? logo() : ''}${inner}${foot}</section>`;
}
function head(label, title, color = '#2E4A7A') {
  return `<div style="position:absolute;left:64px;top:96px;font-size:13px;font-weight:800;letter-spacing:.08em;color:${color}">${label}</div>`
    + `<h1 style="position:absolute;left:64px;top:118px;right:64px;margin:0;font-size:38px;font-weight:800;line-height:1.08">${title}</h1>`;
}
function bar(pct, color, h = 14) {
  return `<span style="display:block;background:#EEF0F4;border-radius:5px;height:${h}px"><span style="display:block;width:${f0(Math.max(0, Math.min(100, pct)))}%;height:${h}px;border-radius:5px;background:${color}"></span></span>`;
}
function card(title, body, bg = '#F1EEFB', fg = '#5A4BA8', extra = '') {
  return `<div style="background:${bg};border-radius:16px;padding:14px 18px;${extra}"><div style="font-size:13px;font-weight:800;letter-spacing:.06em;color:${fg}">${title.toUpperCase()}</div>${body}</div>`;
}
function ul(items, size = 15) {
  return `<ul style="margin:6px 0 0;padding-left:19px;font-size:${Math.trunc(size)}px;line-height:1.5;color:#2E3470">${items.map((x) => `<li style="margin-top:5px">${E(x)}</li>`).join('')}</ul>`;
}
function aboutNIn10(p) {
  const n = rnd(p * 10);
  if (n <= 0) return 'fewer than 1 in 10';
  if (n >= 10) return 'nearly all';
  if (n === 5) return 'about half';
  return `about ${n} in 10`;
}
function spreadWord(q1, q3) {
  const w = q3 - q1;
  return w < SPREAD.CLOSE ? 'fairly close together' : (w >= SPREAD.WIDE ? 'spread widely' : 'spread over a moderate range');
}
function alloc100(bins) {
  const tot = Math.max(1, bins.reduce((a, b) => a + b[1], 0));
  const raw = bins.map(([, n]) => (100.0 * n) / tot);
  const base = raw.map((x) => Math.trunc(x));
  const rest = 100 - base.reduce((a, b) => a + b, 0);
  const order = raw.map((_, i) => i).sort((a, b) => (raw[b] - base[b]) - (raw[a] - base[a]));
  for (const i of order.slice(0, rest)) base[i] += 1;
  return base;
}
const loOf = (lb) => Math.trunc(parseFloat(lb.slice(0, 3)));
function dotsSvg(bins, color, size = 250, label = 'One hundred dots, each about one student') {
  const cnt = alloc100(bins); const seq = [];
  bins.forEach(([lb], i) => { for (let j = 0; j < cnt[i]; j += 1) seq.push(loOf(lb)); });
  const step = size / 10.0; const out = [];
  seq.forEach((lo, i) => {
    const op = Object.prototype.hasOwnProperty.call(OPAQ, lo) ? OPAQ[lo] : 1.0;
    out.push(`<circle cx="${f1((i % 10) * step + step / 2)}" cy="${f1(Math.floor(i / 10) * step + step / 2)}" r="${f1(step * 0.38)}" fill="${color}" fill-opacity="${pyFixed(op, 2)}"/>`);
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">${out.join('')}</svg>`;
}
function legend(bins, color) {
  const cnt = alloc100(bins); const tot = Math.max(1, bins.reduce((a, b) => a + b[1], 0)); let rows = '';
  void cnt;
  for (const [lb, n] of bins) {
    const lo = loOf(lb); const op = Object.prototype.hasOwnProperty.call(OPAQ, lo) ? OPAQ[lo] : 1.0;
    rows += `<div style="display:flex;align-items:center;gap:10px;margin-top:6px;font-size:14px"><span style="width:16px;height:16px;border-radius:50%;background:${color};opacity:${pyFixed(op, 2)};flex-shrink:0"></span><span style="width:84px;font-weight:700">${lb}</span><span>${n} students (${rnd((100.0 * n) / tot)}%)</span></div>`;
  }
  return rows;
}
const modeIdx = (bins) => { let mi = 0; bins.forEach((b, i) => { if (b[1] > bins[mi][1]) mi = i; }); return mi; };
const ageGap = (s) => {
  if (s.scored && s.band_ok && Object.keys(s.band || {}).length > 1) { const v = Object.values(s.band).map((x) => x[1]); return Math.max(...v) - Math.min(...v); }
  return null;
};
const bandForm = (form) => (/EMERG|ADULT/.test(String(form).toUpperCase()) ? ['D3', 'D4'] : ['D1', 'D2']);
const bandText = (form) => bandForm(form).map((b) => BAND_LABEL[b].replace('Ages ', '')).join(' and ');
const directionText = (m) => (!m.has_reverse
  ? 'Every statement in this version is worded in the same direction, so no answers are reversed before averaging.'
  : 'Some statements are worded the other way round. Their answers are reversed before averaging so that every answer points the same way.');
const subNoteLine = (m) => {
  const shown = Object.values(RELEASE_SUB).reduce((a, v) => a + v.length, 0);
  return `${shown} of the ${m.n_sub_total} sub-areas in the questionnaire are reported here. The others are not displayed in this version of the report.`;
};
const secHead = (t) => `<div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">${t}</div>`;

// ---------------------------------------------------------------------------------------------------- pages
function pCover(m) {
  const when = m.dates.length ? `${fdate(m.dates[0])} to ${fdate(m.dates[m.dates.length - 1])}` : '';
  return '<section class="p" style="background:linear-gradient(160deg,#6C9BD6 0%,#A9B0E3 50%,#E3DAF2 100%)">' + tagsHtml(m) + logo('#1E2350', '#6C9BD6')
    + '<svg viewBox="0 0 794 420" width="794" height="420" style="position:absolute;left:0;top:90px" role="img" aria-label="Seven coloured dots resting on a balance">'
    + '<circle cx="397" cy="210" r="170" fill="#FFFFFF" opacity=".22"/><rect x="389" y="130" width="16" height="190" rx="8" fill="#1E2350"/><ellipse cx="397" cy="326" rx="82" ry="14" fill="#1E2350"/>'
    + '<path d="M217 142L577 132" stroke="#1E2350" stroke-width="11" stroke-linecap="round"/><circle cx="397" cy="136" r="18" fill="#F4C55B" stroke="#1E2350" stroke-width="6"/>'
    + '<circle cx="262" cy="118" r="15" fill="#E56B8F"/><circle cx="312" cy="117" r="15" fill="#F4C55B"/><circle cx="362" cy="116" r="15" fill="#7C6BD0"/>'
    + '<circle cx="432" cy="114" r="15" fill="#3E9C86"/><circle cx="482" cy="113" r="15" fill="#5C8FD6"/><circle cx="532" cy="112" r="15" fill="#F0946B"/><circle cx="577" cy="111" r="15" fill="#FFFFFF"/></svg>'
    + '<div style="position:absolute;left:64px;top:560px;right:64px"><div style="font-size:64px;font-weight:300;line-height:1;letter-spacing:.01em">SANTULAN</div>'
    + '<div style="font-size:32px;font-weight:300;line-height:1.15;margin-top:8px">CAPABILITY DEVELOPMENT REPORT</div>'
    + '<div style="height:2px;background:#1E2350;width:560px;margin:12px 0 10px"></div><div style="font-size:38px;font-weight:300">COHORT BASELINE REPORT</div></div>'
    + `<div style="position:absolute;left:64px;right:64px;top:800px;font-size:17px;line-height:1.6"><b style="font-size:22px">${E(m.inst_name)}</b><br>Cohort: ${E(m.cohort)}<br>${m.N} students<br>Questionnaire taken: ${E(when)}<br>Report ID: ${E(m.report_id)}</div>`
    + '</section>';
}

function pContents(m, no, toc) {
  let rows = '';
  for (const [n, t, pg, sub] of toc) {
    const [pad, fs, fw] = sub === null ? [8, 16, 800] : [3, 14.5, 500];
    rows += `<div style="display:flex;align-items:baseline;gap:16px;padding:${pad}px 0 ${pad}px ${sub === null ? 0 : 46}px;border-bottom:1px solid #ECE8F5;font-size:${fs}px;font-weight:${fw}"><span style="color:#B03F6B;width:30px;font-weight:800">${n}</span>${E(t)}`
      + `<span style="margin-left:auto;font-weight:500;color:#6B7280;font-size:15px">${pg}</span></div>`;
  }
  return frame(m, `<h1 style="position:absolute;left:64px;top:106px;margin:0;font-size:40px;font-weight:800">Contents</h1><div style="position:absolute;left:64px;right:64px;top:176px">${rows}</div>`, no);
}

function pDivider(m, no, part, title, sub) {
  return '<section class="p" style="background:linear-gradient(160deg,#1E2350 0%,#3B4C9B 60%,#6C9BD6 100%);color:#fff">' + tagsHtml(m) + logo('#FFFFFF', '#6C9BD6')
    + `<div style="position:absolute;left:64px;right:64px;top:430px"><div style="font-size:15px;font-weight:800;letter-spacing:.14em;opacity:.8">${part}</div>`
    + `<h1 style="margin:10px 0 0;font-size:54px;font-weight:800;line-height:1.05;color:#fff">${title}</h1><p style="margin:18px 0 0;font-size:19px;line-height:1.5;opacity:.9;max-width:560px">${sub}</p></div>`
    + `<div class="ft" style="color:#fff;opacity:.7"><span>${E(m.inst_name)} &middot; ${E(m.report_id)}</span><span>Page ${no}</span></div></section>`;
}

function pLimits(m, no) {
  const a = '<div style="background:#E8F5EE;border-radius:16px;padding:14px 18px"><div style="font-size:13px;font-weight:800;letter-spacing:.06em;color:#1F6B4A">WHAT THIS REPORT TELLS YOU</div><div style="font-size:16px;line-height:1.5;margin-top:4px;color:#17402F">How this group of students currently describes aspects of themselves across the seven Santulan capabilities.</div></div>';
  const b = '<div style="background:#FBEFE9;border-radius:16px;padding:14px 18px;margin-top:12px"><div style="font-size:13px;font-weight:800;letter-spacing:.06em;color:#9A3412">WHAT IT DOES NOT TELL YOU</div><div style="font-size:16px;line-height:1.5;margin-top:4px;color:#3B2A1E">It does not diagnose students, show any student’s ability, establish causes, put the capabilities in order, or replace professional judgement and conversations with students.</div></div>';
  const ev = `<div style="margin-top:12px;display:inline-block;background:#FBF3DC;border-radius:999px;padding:7px 16px;font-size:14px;font-weight:800;color:#7A5A00">Evidence status: ${E(EVIDENCE_STATUS)}</div>`;
  const secs = [['Where the numbers come from', 'Students rated statements about themselves, once. What a student says can be shaped by mood, the day, the setting, wanting to give a good impression, and how well they know themselves. The numbers describe how students see themselves, not what they can do.'],
    ['This is a pilot', 'The questionnaire and its wording are still being reviewed. There are no comparison groups yet, so a number shows where this group stands today. It does not show whether that is usual for students of the same age.'],
    ['Sub-areas are short', 'Each sub-area rests on two to four questions. Read sub-area figures as pointers for a conversation. A difference of a tenth of a point, such as 3.2 and 3.3, should not be read as meaningful.'],
    ['Use it with what you know', 'Read the report alongside student voice, teacher observation and school records. Decisions about any student should never rest on this report alone.'],
    ['Privacy', 'This report contains aggregated, de-identified cohort information for authorised users only. In a small group, people who know the students may still guess who is behind a figure, so please follow the sharing grant, do not forward the report, and keep printed copies safe.']];
  const body = secs.map(([t, x]) => `<div style="margin-top:14px"><div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">${t.toUpperCase()}</div><p style="margin:3px 0 0;font-size:15px;line-height:1.5;color:#2E3470">${E(x)}</p></div>`).join('');
  return frame(m, head('BEFORE YOU READ', 'What this report is,<br>and is not') + `<div style="position:absolute;left:64px;right:64px;top:250px">${a}${b}${ev}${body}</div>`, no);
}

function pAbout2(m, no) {
  const t = (big, small) => `<div style="background:#F1EEFB;border-radius:16px;padding:14px 16px"><div style="font-size:30px;font-weight:800;color:#1E2350">${big}</div><div style="font-size:13.5px;font-weight:700;color:#2E3470;margin-top:2px">${small}</div></div>`;
  const tiles = `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${t('7', 'capabilities')}${t(m.n_sub_total, 'sub-areas')}${t(m.n_questions, 'questions in this version')}${t('1–5', 'scale for every answer')}</div>`;
  const parts = [['What a capability is', 'A capability is a developable pattern of awareness, understanding, regulation, relationships and purposeful action that can support how a young person engages with themselves, other people, challenges and learning. Santulan groups seven capabilities into Body & Feelings, Self & Others, and Direction & Learning.'],
    ['How the questionnaire works', `Students rate statements about themselves from 1 (${ANCHORS[0]}) to 5 (${ANCHORS[ANCHORS.length - 1]}). The five answer choices are: ${ANCHORS.map((a, i) => `${i + 1} = ${a}`).join(', ')}. ${directionText(m)} A capability number is the plain mean of a student’s answers in that capability. Because students describe themselves, the numbers show current perceptions, not direct measurements of ability.`],
    ['How this report uses it', 'The report puts students together. It shows how the group’s numbers are spread in each capability, and how reported sub-areas sit against the capability’s own average. Nothing is compared between capabilities, and no student is labelled.'],
    ['What is held back', 'Some questions are not reported to institutions in this pilot, and are left out of every figure. See the technical notes at the back for the counts.']];
  const body = parts.map(([a, b]) => `<div style="margin-top:18px"><div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">${a.toUpperCase()}</div><p style="margin:5px 0 0;font-size:15.5px;line-height:1.55;color:#2E3470">${E(b)}</p></div>`).join('');
  const ref = !m.draft ? '' : '<div class="card" style="margin-top:20px;background:#FBF3DC"><b class="k" style="color:#7A5A00">For the content owner (draft only)</b><div>Add the evidence base and reference list here before release (OD-25). Nothing is claimed about validation until you supply it.</div></div>';
  return frame(m, head('ABOUT SANTULAN', 'How the questionnaire<br>is built') + `<div style="position:absolute;left:64px;right:64px;top:250px">${tiles}${body}${ref}</div>`, no);
}

function pFirst(m, no) {
  const N = m.N; const cov7 = rnd((100.0 * m.all7) / N);
  const thin = ORDER.filter((k) => m.stats[k].n / N < COVER_CARE);
  const wide = ORDER.filter((k) => m.stats[k].scored && (m.stats[k].q3 - m.stats[k].q1) >= SPREAD.WIDE);
  const away = []; for (const k of ORDER) for (const d of m.sub[k]) if (d.shown && Math.abs(d.delta) >= SUB_DELTA) away.push([k, d]);
  let nshown = 0; for (const k of ORDER) for (const d of m.sub[k]) if (d.shown) nshown += 1;
  const c1 = ['Who took part', `<b>${m.all7} of ${N} students (${cov7}%)</b> have a reportable number in all seven capabilities.`];
  const c2 = ['Data coverage', thin.length
    ? `In ${thin.length} of the seven capabilities fewer than ${rnd(COVER_CARE * 100)}% of students have a reportable number (${thin.join(', ')}). Read those with extra care.`
    : `In every capability at least ${rnd(COVER_CARE * 100)}% of students have a reportable number. That is strong coverage for describing the cohort. Coverage shows how much usable data there is, not how accurate the numbers are.`];
  const c3 = ['Spread of students', wide.length
    ? `In <b>${wide.length} of the seven</b> capabilities the middle half of students spans ${f1(SPREAD.WIDE)} points or more (${wide.join(', ')}), so one average hides real differences between students.`
    : `In none of the seven capabilities does the middle half of students span ${f1(SPREAD.WIDE)} points or more. An average still hides differences between students.`];
  let c4;
  if (away.length) {
    const ex = away.slice(0, 2).map(([k, d]) => `${E(d.name)} (${k}): ${f1(d.avg)} against ${f1(m.stats[k].avg)}`).join('; ');
    c4 = ['Sub-area patterns', `Among the ${nshown} reported sub-areas, <b>${away.length}</b> differ from their capability average by ${f1(SUB_DELTA)} points or more under the pilot exploration rule, for example ${ex}. This is a provisional rule.`];
  } else c4 = ['Sub-area patterns', `Among the ${nshown} reported sub-areas, none differ from their capability average by ${f1(SUB_DELTA)} points or more under the pilot exploration rule. This is a provisional rule.`];
  const c5 = ['Age bands', 'Each capability page shows the average and the number of students in each age band. These figures are descriptive. Differences between ages are not interpreted in this pilot.'];
  const cards = [c1, c2, c3, c4, c5].map(([t, b], i) => `<div style="display:flex;gap:14px;margin-top:9px;background:#F7F5FD;border-radius:14px;padding:10px 14px"><div style="width:30px;height:30px;flex-shrink:0;border-radius:50%;background:#5A4BA8;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</div><div><div style="font-size:12.5px;font-weight:800;letter-spacing:.06em;color:#5A4BA8">${t.toUpperCase()}</div><div style="font-size:14.5px;line-height:1.42;color:#2E3470;margin-top:2px">${b}</div></div></div>`).join('');
  const nxt = ul(['Read “How to read this report” (5 minutes).', 'Meet as a team. Use the questions on each capability’s second page. Choose one or two capabilities to explore.', 'Fill in the plan, and decide when students will answer again.'], 14.5);
  const safe = 'This report cannot show which students need help. If you are worried about a student, do not wait for this report: speak to your school counsellor or student-safety lead today.';
  const inner = head('KEY INSIGHTS', 'The picture in<br>one minute')
    + `<div style="position:absolute;left:64px;right:64px;top:250px"><div style="background:#F1EEFB;border-radius:16px;padding:13px 18px;font-size:16px;line-height:1.5;color:#1E2350"><b>${N} students</b> at ${E(m.inst_name)} answered the Santulan questionnaire. This shows how the group describes itself today in <b>seven capabilities</b>. It is a baseline picture, not a verdict.</div>`
    + `${cards}<div style="margin-top:14px;font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">WHAT TO DO NEXT</div>${nxt}`
    + `<div style="margin-top:10px;background:#FBEFE9;border-radius:14px;padding:10px 16px"><div style="font-size:12.5px;font-weight:800;letter-spacing:.06em;color:#9A3412">IF YOU ARE WORRIED ABOUT A STUDENT</div><div style="font-size:14.5px;line-height:1.45;margin-top:3px;color:#3B2A1E">${E(safe)}</div></div></div>`;
  return frame(m, inner, no);
}

function pHowto(m, no) {
  const exBins = [['1.0 to 2.9', 20], ['3.0 to 3.9', 50], ['4.0 to 5.0', 30]];
  let scale = '<svg viewBox="0 0 330 70" width="330" height="70" role="img" aria-label="A line from 1 to 5 with one dot at 3.4"><line x1="15" y1="38" x2="315" y2="38" stroke="#C9C4E4" stroke-width="4" stroke-linecap="round"/>';
  for (let i = 0; i < 5; i += 1) scale += `<text x="${15 + i * 75}" y="64" font-size="13" text-anchor="middle" fill="#4B5563">${i + 1}</text><line x1="${15 + i * 75}" y1="32" x2="${15 + i * 75}" y2="44" stroke="#C9C4E4" stroke-width="2"/>`;
  scale += '<circle cx="195" cy="38" r="11" fill="#5A4BA8"/><text x="195" y="16" font-size="13" font-weight="700" text-anchor="middle" fill="#1E2350">3.4</text></svg>';
  const steps = [['1', 'Each student answers questions about each capability.'], ['2', 'Answers run from 1 (Almost never) to 5 (Almost always). We take the average of a student’s answers.'], ['3', 'We put all the students together and draw one picture per capability.']];
  const st = steps.map(([a, b]) => `<div style="display:flex;gap:12px;align-items:flex-start;margin-top:10px"><div style="width:28px;height:28px;flex-shrink:0;border-radius:50%;background:#5A4BA8;color:#fff;font-weight:800;text-align:center;line-height:28px">${a}</div><div style="font-size:15px;line-height:1.45;color:#2E3470">${E(b)}</div></div>`).join('');
  const ex = `<div style="display:flex;gap:22px;align-items:center">${dotsSvg(exBins, '#5A4BA8', 180, 'Example only')}<div><div style="font-size:12px;font-weight:800;letter-spacing:.06em;color:#9A3412">EXAMPLE ONLY &middot; NOT YOUR DATA</div>${legend(exBins, '#5A4BA8')}<div style="font-size:13px;color:#4B5563;margin-top:6px">Each dot is about 1 student out of 100. Darker dots are students whose average is nearer 5.</div></div></div>`;
  const nots = [['A number is not a measure of ability.', 'It shows how students see themselves today. Capabilities can grow.'], ['Numbers are not comparable between capabilities.', 'A 3.2 in one capability does not mean the same as a 3.2 in another. Please do not put them in order.'], ['A missing number says nothing about the student.', 'It only means there were not enough answers in that capability.']];
  const nt = nots.map(([a, b]) => `<div style="margin-top:10px"><b style="font-size:15px;color:#1E2350">${E(a)}</b><div style="font-size:14.5px;line-height:1.45;color:#2E3470">${E(b)}</div></div>`).join('');
  const chips = [['Complete', 'The student answered every question for that capability.'], ['Early estimate', 'A few answers were missing (fewer than 20%). The number is still shown.'], ['Not enough data yet', '20% or more of the answers were missing, so there is no number.']]
    .map(([a, b]) => `<div style="display:flex;gap:10px;align-items:baseline;margin-top:7px;font-size:14.5px"><b style="width:150px;flex-shrink:0">${a}</b><span style="color:#2E3470">${E(b)}</span></div>`).join('');
  const inner = head('HOW TO READ THIS REPORT', 'Every picture,<br>explained')
    + `<div style="position:absolute;left:64px;right:64px;top:250px"><div style="display:grid;grid-template-columns:1fr 330px;gap:26px;align-items:center"><div>${st}</div><div>${scale}</div></div>`
    + `<div style="margin-top:26px">${card('How a picture is made', ex, '#fff', '#5A4BA8', 'border:1.5px solid #E5E1F7')}</div>`
    + `<div style="margin-top:26px;font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">THREE THINGS A NUMBER IS NOT</div>${nt}`
    + `<div style="margin-top:22px;font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">THE THREE STATUSES</div>${chips}</div>`;
  return frame(m, inner, no);
}

function pSummary(m, no) {
  const N = m.N;
  const tile = (big, small, sub = '') => `<div style="background:#F1EEFB;border-radius:16px;padding:14px 16px"><div style="font-size:30px;font-weight:800;color:#1E2350;line-height:1.1">${big}</div><div style="font-size:13px;font-weight:700;margin-top:4px;color:#2E3470">${small}</div><div style="font-size:12px;color:#4B5563;margin-top:2px">${sub}</div></div>`;
  const pct = (n) => rnd((100.0 * n) / N);
  const t1 = tile(String(N), 'students in this summary', m.enrolled ? `of ${m.enrolled} enrolled (${rnd((100.0 * N) / m.enrolled)}%)` : 'enrolment count not given');
  const t2 = tile(m.finish_all >= MINN ? `${pct(m.finish_all)}%` : hide(m.finish_all), 'answered every question', m.med_completion ? `median ${rnd(100 * m.med_completion)}% of questions answered` : '');
  const t3 = tile(m.all7 >= MINN ? `${pct(m.all7)}%` : hide(m.all7), 'have a number in all seven', `${hide(m.all7)} of ${N} students`);
  const tt = [...m.t_total.values()].sort((a, b) => a - b); const med = tt.length >= MINN ? median(tt) : null;
  const t4 = tile(med ? `${f0(med)} min` : '–', 'median time to finish', m.time_basis === 'measured' ? 'sum of time per question' : 'first to last answer');
  let rows = '';
  for (const k of ORDER) {
    const s = m.stats[k]; const c = clusterOf(k); const tot = Math.max(1, s.n_all);
    const seg = (n, col) => `<span style="display:block;width:${f1((100.0 * n) / tot)}%;background:${col}"></span>`;
    rows += `<div style="display:grid;grid-template-columns:34px 250px 1fr 120px;gap:10px;align-items:center;margin-top:10px;font-size:14px"><span style="font-size:12px;font-weight:800;border-radius:7px;text-align:center;background:${c.bg};color:${c.fg}">${k}</span><span style="font-weight:700">${E(DOM[k].name)}</span>`
      + `<span style="display:flex;height:16px;border-radius:5px;overflow:hidden;background:#EEF0F4">${seg(s.complete, c.fg)}${seg(s.early, '#B9B4DD')}</span><span style="font-size:13px">${s.complete + s.early} of ${s.n_all} (${rnd((100.0 * (s.complete + s.early)) / tot)}%)</span></div>`;
  }
  const rs = m.rs; let style;
  if (rs.n >= MINN && (rs.ext >= MINN || rs.mid >= MINN)) {
    const bits = [];
    if (rs.ext >= MINN) bits.push(`${rs.ext} students (${rnd((100.0 * rs.ext) / rs.n)}%) answered mostly with the two ends of the scale (1 or 5)`);
    if (rs.mid >= MINN) bits.push(`${rs.mid} students (${rnd((100.0 * rs.mid) / rs.n)}%) answered mostly with the middle (3)`);
    style = `${bits.join('; ')}. These are response-pattern indicators (pilot thresholds), not evidence of careless or dishonest answering. They can make averages look more or less spread out.`;
  } else style = `No unusual answer pattern to report: fewer than ${MINN} students answered mostly with the two ends or mostly with the middle of the scale.`;
  const inner = head('SUMMARY FOR LEADERS', 'This cohort at a glance')
    + `<div style="position:absolute;left:64px;right:64px;top:196px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${t1}${t2}${t3}${t4}</div>`
    + `<div style="position:absolute;left:64px;right:64px;top:360px"><h2 style="margin:0;font-size:20px;font-weight:800">How many students have a number in each capability</h2>`
    + `<p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:#4B5563">Dark part: Complete. Light part: Early estimate. Grey part: Not enough data yet. This is about how much data there is, not about the students. Read an average with more care where fewer students have a number.</p>${rows}</div>`
    + `<div style="position:absolute;left:64px;right:64px;top:790px">${card('How students used the scale', `<p style="margin:6px 0 0;font-size:14.5px;line-height:1.5;color:#2E3470">${E(style)}</p>`)}</div>`;
  return frame(m, inner, no);
}

function pTook2(m, no) {
  const N = m.N; const consentOk = m.n_records - m.n_consent_out - m.n_withdrawn;
  const steps = [];
  if (m.enrolled) steps.push(['Enrolled (given by the institution)', m.enrolled, 'The number of students the institution says are in this cohort.']);
  steps.push(['Records in Santulan', m.n_records, 'Students with a Santulan record for this cohort.'],
    ['Consent verified, not withdrawn', consentOk, 'Consent is verified and the student has not withdrawn.'],
    ['Questionnaire submitted', m.n_submitted, 'A finished questionnaire was received.'],
    ['Included in this report', N, 'Report released as normal, so the answers can be counted.']);
  const top = Math.max(1, steps[0][1]);
  const fun = steps.map(([a, n, d]) => `<div style="margin-top:10px"><div style="display:grid;grid-template-columns:250px 1fr 54px;gap:10px;align-items:center;font-size:14.5px"><span style="font-weight:700">${E(a)}</span>${bar((100.0 * n) / top, '#5A4BA8', 14)}<span style="font-weight:800">${n}</span></div><div style="font-size:12.5px;color:#4B5563;margin-left:0">${E(d)}</div></div>`).join('');
  const notes = [];
  if (m.enrolled && m.enrolled > m.n_records) notes.push(`${m.enrolled - m.n_records} enrolled students have no Santulan record. This report cannot tell why.`);
  const gone = m.n_consent_out + m.n_withdrawn;
  if (gone) notes.push(`${gone >= MINN ? String(gone) : `Fewer than ${MINN}`} records were left out for consent reasons.`);
  const noSub = m.n_records - gone - m.n_submitted;
  if (noSub > 0) notes.push(`${noSub >= MINN ? String(noSub) : `Fewer than ${MINN}`} consented students have no submitted questionnaire.`);
  if (m.n_submitted_not_included) notes.push(`${m.n_submitted_not_included >= MINN ? String(m.n_submitted_not_included) : `Fewer than ${MINN}`} submitted questionnaires are not included (held for review or could not be processed).`);
  const fnote = `<p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#4B5563">${notes.length ? E(notes.join(' ')) : 'Nobody was left out between steps.'}</p>`;
  const ages = [...m.age_years.entries()].sort((a, b) => a[0] - b[0]); const mx = Math.max(...ages.map(([, n]) => n), 1);
  const cols = ages.map(([a, n]) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px"><span style="font-size:12px;font-weight:700">${n < MINN ? `&lt;${MINN}` : n}</span><div style="width:70%;height:${Math.max(4, Math.trunc((90.0 * n) / mx))}px;border-radius:5px 5px 0 0;background:#5A4BA8"></div><span style="font-size:12px;color:#4B5563">${a}</span></div>`).join('');
  const chart = `<div style="display:flex;gap:6px;height:130px;align-items:flex-end;margin-top:8px">${cols}</div><div style="font-size:12.5px;color:#4B5563;margin-top:4px">Age in years. Counts under ${MINN} are not shown.</div>`;
  const small = [...m.bands].filter(([, n]) => n < MINN);
  const bl = ['D1', 'D2', 'D3', 'D4'].filter((b) => m.bands.get(b)).map((b) => `<div style="display:grid;grid-template-columns:150px 1fr 110px;gap:12px;align-items:center;margin-top:8px;font-size:14.5px"><span style="font-weight:700">${BAND_LABEL[b]}</span>${bar((100.0 * m.bands.get(b)) / N, '#3E9C86', 14)}<span>${hide(m.bands.get(b))} students</span></div>`).join('');
  const bnote = small.length ? `At least one age band has fewer than ${MINN} students, so age-band figures are not shown in this report.` : 'Age bands follow the questionnaire’s own bands and are shown descriptively.';
  const inner = head('WHO TOOK PART', 'The students in<br>this report')
    + `<div style="position:absolute;left:64px;right:64px;top:250px"><h2 style="margin:0;font-size:20px;font-weight:800">From enrolment to this report</h2>${fun}${fnote}`
    + `<h2 style="margin:22px 0 0;font-size:20px;font-weight:800">Ages</h2>${chart}`
    + `<h2 style="margin:20px 0 0;font-size:20px;font-weight:800">Age bands</h2>${bl}<p style="margin:6px 0 0;font-size:14px;color:#4B5563">${bnote}</p>`
    + `<p style="margin:10px 0 0;font-size:14px;color:#4B5563"><b>Language.</b> Questionnaire language: ${E(m.locale)}. Class and gender are not part of this version of the report.</p></div>`;
  return frame(m, inner, no);
}

function pSeven(m, no) {
  const blocks = []; const tops = { A: 250, B: 486, C: 720 };
  for (const cid of ['A', 'B', 'C']) {
    const c = C.CLUSTER[cid]; const doms = ORDER.filter((k) => DOM[k].cluster === cid);
    const items = doms.map((k) => `<div style="display:flex;gap:14px;align-items:center"><div style="width:46px;height:46px;flex-shrink:0;border-radius:50%;background:#fff;border:1.5px solid #D9D4EE;display:flex;align-items:center;justify-content:center">${icon(k, c.fg)}</div><div><b style="font-size:15px">${E(DOM[k].name)}</b><span style="font-size:14px;line-height:1.5;display:block;color:#2E3470">${E(MEANING[k][1])}</span></div></div>`).join('');
    const badge = `<div style="width:130px;flex-shrink:0;text-align:center"><div style="width:84px;height:84px;margin:0 auto;border-radius:50%;background:${c.badge};display:flex;align-items:center;justify-content:center"><svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="${c.fg}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${C.CLUSTER_ICON[cid]}</svg></div><div style="font-weight:800;color:${c.fg};font-size:15px;margin-top:8px;line-height:1.2">${E(c.name)}</div></div>`;
    blocks.push(`<div style="position:absolute;left:52px;right:52px;top:${tops[cid]}px;background:${c.bg};border-radius:22px;padding:20px 24px;display:flex;gap:22px;align-items:center">${badge}<div style="border-left:1.5px dashed ${c.dash};padding-left:20px;display:flex;flex-direction:column;gap:12px">${items}</div></div>`);
  }
  return frame(m, head('THE SEVEN CAPABILITIES', 'The seven capabilities<br>in this report') + blocks.join(''), no);
}

function pCapA(m, no, k) {
  const s = m.stats[k]; const c = clusterOf(k); const N = m.N;
  const chip = `<span style="font-size:13px;font-weight:800;padding:3px 10px;border-radius:8px;background:${c.bg};color:${c.fg}">${k} &middot; ${E(c.name)}</span>`;
  const two = DOM[k].name.length >= 36;
  const top = `<div style="position:absolute;left:64px;top:96px">${chip}</div><h1 style="position:absolute;left:64px;top:126px;right:64px;margin:0;font-size:34px;font-weight:800;line-height:1.1">${E(DOM[k].name)}</h1>`;
  const sub = `<div style="position:absolute;left:64px;right:64px;top:${two ? 210 : 168}px;font-size:16px;line-height:1.45;color:#2E3470">${E(MEANING[k][1])}</div>`;
  const y0 = two ? 268 : 226;
  if (!s.scored) {
    const body = card('What we see', `<p style="margin:6px 0 0;font-size:16px;line-height:1.55">Fewer than ${MINN} students have a reportable number in this capability, so no picture is drawn. This says nothing about the students. Please read the other capabilities on their own.</p>`, '#F1EEFB', '#5A4BA8', `position:absolute;left:64px;right:64px;top:${y0}px`);
    return frame(m, top + sub + body, no);
  }
  const tot = Math.max(1, s.bins.reduce((a, b) => a + b[1], 0)); const mode = modeIdx(s.bins); const pMode = s.bins[mode][1] / tot;
  const left = `<div style="position:absolute;left:64px;top:${y0}px;width:262px">${dotsSvg(s.bins, c.fg)}<div style="font-size:13px;color:#4B5563;margin-top:6px">If this cohort were 100 students. Each dot is about 1 student.</div>${legend(s.bins, c.fg)}</div>`;
  const reading = `<p style="margin:0">Students’ average self-rating is <b style="font-size:22px">${f1(s.avg)}</b> on the 1 to 5 scale.</p>`
    + `<p style="margin:10px 0 0"><b>${cap(aboutNIn10(pMode))}</b> of the students average between <b>${s.bins[mode][0].replace(' to ', ' and ')}</b>. The middle half of students are between <b>${f1(s.q1)} and ${f1(s.q3)}</b>.</p>`
    + '<p style="margin:10px 0 0;color:#4B5563">The ranges only show how answers are spread; they are not levels or grades. An average hides differences: use it to start a conversation, not to settle one.</p>';
  const right = `<div style="position:absolute;left:350px;right:64px;top:${y0}px">${card('What we see', `<div style="font-size:15.5px;line-height:1.5;color:#2E3470">${reading}</div>`, '#fff', c.fg, 'border:1.5px solid #E5E1F7')}</div>`;
  const cov = s.n / N;
  const cvg = [`A reportable number is available for ${s.n} of ${N} students (${rnd(100 * cov)}%).`,
    cov < COVER_CARE ? `Read with extra care: fewer than ${rnd(COVER_CARE * 100)}% of students have a number.` : 'Coverage shows how much usable data there is. It does not by itself show that the numbers are accurate.'];
  const st = m.style[k];
  for (const [lbl, key] of [['answers mostly at the two ends', 'ext'], ['answers mostly in the middle', 'mid'], ['the same answer all through', 'same']]) {
    if (st[key] >= MINN) cvg.push(`Response pattern: ${st[key]} students gave ${lbl}. This is an indicator, not a judgement of the students.`);
  }
  const y1 = y0 + 300 + 26 * s.bins.length;
  const covCard = card('Data coverage and response quality', ul(cvg, 14), '#EEF0F4', '#374151');
  let agecard;
  if (s.band_ok && Object.keys(s.band).length > 1) {
    const bars = Object.entries(s.band).map(([b, [n, a]]) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><span style="font-size:15px;font-weight:800;color:${c.fg}">${f1(a)}</span><div style="width:60%;height:${Math.trunc((70 * (a - 1)) / 4.0) + 6}px;background:${c.fg};border-radius:6px 6px 0 0"></div><span style="font-size:12.5px;margin-top:4px;color:#4B5563;text-align:center">${BAND_LABEL[b]}<br>${n} students</span></div>`).join('');
    agecard = card('By age band (descriptive)', `<div style="display:flex;gap:10px;height:128px;align-items:flex-end;margin-top:6px">${bars}</div><div style="font-size:12.5px;line-height:1.35;color:#4B5563;margin-top:6px">Descriptive only. Differences between ages should not be read as meaningful without age-comparison evidence.</div>`, '#fff', c.fg, 'border:1.5px solid #E5E1F7');
  } else agecard = card('By age band', `<p style="margin:6px 0 0;font-size:13.5px;line-height:1.45;color:#4B5563">Age-band figures are not shown because at least one band has fewer than ${MINN} students.</p>`, '#fff', c.fg, 'border:1.5px solid #E5E1F7');
  const bottom = `<div style="position:absolute;left:64px;right:64px;top:${y1}px;display:grid;grid-template-columns:1.35fr 1fr;gap:12px">${covCard}${agecard}</div>`;
  const note = '<div style="position:absolute;left:64px;right:64px;top:1044px;font-size:12px;line-height:1.3;color:#4B5563">Averages cannot be compared between capabilities. Turn the page for the sub-areas inside this capability.</div>';
  return frame(m, top + sub + left + right + bottom + note, no);
}

function lolli2(d, capAvg, color, W = 232) {
  const x = (v) => ((v - 1) / 4.0) * W;
  return `<svg viewBox="0 0 ${W} 34" width="${W}" height="34" role="img" aria-label="Average ${f1(d.avg)}"><rect x="0" y="14" width="${W}" height="6" rx="3" fill="#EEF0F4"/>`
    + `<rect x="${f1(x(d.q1))}" y="10" width="${f1(x(d.q3) - x(d.q1))}" height="14" rx="5" fill="${color}" fill-opacity=".30"/><line x1="${f1(x(capAvg))}" y1="3" x2="${f1(x(capAvg))}" y2="31" stroke="#1E2350" stroke-width="1.6" stroke-dasharray="3 2"/>`
    + `<circle cx="${f1(x(d.avg))}" cy="17" r="7.5" fill="${color}"/></svg>`;
}

function pCapB(m, no, k) {
  const s = m.stats[k]; const c = clusterOf(k); const N = m.N;
  const chip = `<span style="font-size:13px;font-weight:800;padding:3px 10px;border-radius:8px;background:${c.bg};color:${c.fg}">${k} &middot; inside the capability</span>`;
  const two = DOM[k].name.length >= 36;
  const top = `<div style="position:absolute;left:64px;top:96px">${chip}</div><h1 style="position:absolute;left:64px;top:126px;right:64px;margin:0;font-size:30px;font-weight:800;line-height:1.1">${E(DOM[k].name)}</h1>`;
  let y = two ? 214 : 176;
  const rows = m.sub[k]; let [ideas, qs] = IDEAS[k];
  if (!s.scored || !rows.some((r) => r.shown)) {
    const body = card('Sub-areas', `<p style="margin:6px 0 0;font-size:15.5px;line-height:1.5">Fewer than ${MINN} students have a number for these sub-areas, so none are shown. This says nothing about the students.</p>`, '#F1EEFB', '#5A4BA8', `position:absolute;left:64px;right:64px;top:${y}px`);
    return frame(m, top + body, no);
  }
  const intro = `<div style="position:absolute;left:64px;right:64px;top:${y}px;font-size:13px;line-height:1.45;color:#4B5563"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c.fg};vertical-align:middle"></span> sub-area average &nbsp; `
    + `<span style="display:inline-block;width:26px;height:10px;border-radius:4px;background:${c.fg};opacity:.3;vertical-align:middle"></span> middle half of students &nbsp; <span style="display:inline-block;width:0;height:14px;border-left:2px dashed #1E2350;vertical-align:middle"></span> capability average (${f1(s.avg)}). Scale 1 to 5. `
    + 'Sub-areas are brief indicators from a few questions: a difference of a tenth of a point is not meaningful.</div>';
  y += 58;
  const RH = rows.length <= 6 ? 66 : 56; const long_ = rows.length > 6;
  if (long_) { ideas = ideas.slice(0, 2); qs = qs.slice(0, 1); }
  let out = ''; const away = [];
  for (const r of rows) {
    let chart; let val; let flag;
    if (r.shown) {
      flag = Math.abs(r.delta) >= SUB_DELTA; if (flag) away.push(r);
      chart = lolli2(r, s.avg, c.fg); val = `<b style="font-size:17px">${f1(r.avg)}</b><div style="font-size:11.5px;color:#4B5563;line-height:1.2">n=${r.n}<br>${rnd((100.0 * r.n) / N)}%</div>`;
    } else { chart = `<div style="font-size:13px;color:#6B7280">Fewer than ${MINN} students have a number</div>`; val = '–'; flag = false; }
    out += `<div style="display:grid;grid-template-columns:262px 232px 56px;gap:12px;align-items:center;height:${RH}px;box-sizing:border-box;overflow:hidden;padding:3px 0;border-bottom:1px solid #ECE8F5${flag ? ';background:#FFF9E8' : ''}"><div><b style="font-size:14.5px">${E(r.name)}</b><div style="font-size:12.5px;line-height:1.35;color:#4B5563">${E(r.gloss)}</div></div><div>${chart}</div><div style="text-align:right">${val}</div></div>`;
  }
  const body = `<div style="position:absolute;left:64px;right:64px;top:${y}px">${out}</div>`;
  y += rows.length * RH + 8;
  let lines = away.slice(0, long_ ? 2 : 3).map((r) => `<b>${E(r.name)}</b>: average ${f1(r.avg)} (${r.n} students) against a capability average of ${f1(s.avg)}.`);
  if (away.length > lines.length) lines.push(`And ${away.length - lines.length} more, shaded above.`);
  if (!lines.length) lines = [`Among the reported sub-areas here, none differ from the capability average by ${f1(SUB_DELTA)} points or more.`];
  const innerW = lines.map((l) => `<div style="margin-top:4px">${l}</div>`).join('') + `<div style="margin-top:6px;color:#4B5563;font-size:12.5px;line-height:1.4">Pilot exploration rule: a difference of ${f1(SUB_DELTA)} points or more is flagged. This is provisional and not a validated threshold. Sub-areas are not put in order of size and are not labelled. ${E(subNoteLine(m))}</div>`;
  const wcard = `<div style="position:absolute;left:64px;right:64px;top:${y}px">${card('Sub-area patterns', `<div style="font-size:14.5px;line-height:1.45;color:#3B2A1E">${innerW}</div>`, '#FBF3DC', '#7A5A00')}</div>`;
  y += 112 + 24 * lines.length - (long_ ? 14 : 0);
  const twoC = `<div style="position:absolute;left:64px;right:64px;top:${y}px;display:grid;grid-template-columns:1.2fr 1fr;gap:14px">${card('Ideas to talk about', ul(ideas, 14), c.bg, c.fg)}${card('Questions for your team', ul(qs, 14), '#EEF0F4', '#374151')}</div>`;
  const note = '<div style="position:absolute;left:64px;right:64px;top:1048px;font-size:12px;line-height:1.3;color:#4B5563">Ideas are conversation starters from general school practice, not promises of change.</div>';
  return frame(m, top + intro + body + wcard + twoC + note, no);
}

function pDecide(m, no) {
  const steps = [['Look', 'Write down what you expect, then compare. Surprises are the most useful part.'],
    ['Make sense', 'Check the picture against student voice, teacher observation and school records. A number is a question, not an answer.'],
    ['Choose', 'Pick one or two capabilities by what matters to your students, what you can influence, and what you can check next time. Not by comparing averages across capabilities.'],
    ['Act and check', 'Try one small, reversible step. Ask the same group again after a term and compare the cohort with itself.']];
  const cards = steps.map(([a, b], i) => `<div style="background:#F1EEFB;border-radius:14px;padding:10px 14px"><div style="font-size:12px;font-weight:800;color:#5A4BA8;letter-spacing:.06em">STEP ${i + 1}</div><div style="font-size:17px;font-weight:800;color:#1E2350">${a}</div><div style="font-size:13.5px;line-height:1.4;margin-top:3px;color:#2E3470">${E(b)}</div></div>`).join('');
  const cols = ['Capability and sub-area', 'What students tell us', 'Other evidence (teachers, records)', 'Student voice: how collected', 'One small step, who', 'Start and review dates', 'How we will know'];
  const blankRow = `<tr>${cols.map(() => '<td style="height:62px;border:1px solid #D9D4EE"></td>').join('')}</tr>`;
  const ws = `<table class="snap" style="table-layout:fixed"><thead><tr>${cols.map((c) => `<th style="font-size:11.5px">${c}</th>`).join('')}</tr></thead><tbody>${blankRow.repeat(3)}</tbody></table>`;
  const rules = ul(['A Santulan number alone never decides an action. Combine it with student voice, teacher observation and school records.', 'Keep steps small, testable and reversible. Include students in the decision.',
    'When students answer again, compare the same capability over time and say how many answered both times. A change does not by itself show that an action caused it.'], 14);
  const inner = head('DECIDING WHAT TO DO', 'From picture<br>to plan')
    + `<div style="position:absolute;left:64px;right:64px;top:244px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${cards}</div>`
    + `<div style="position:absolute;left:64px;right:64px;top:560px"><div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#5A4BA8">YOUR PLAN (WRITE IN PEN)</div><div style="margin-top:8px">${ws}</div></div>`
    + `<div style="position:absolute;left:64px;right:64px;top:870px">${card('Good habits for decisions', rules, '#EEF0F4', '#374151')}</div>`;
  return frame(m, inner, no);
}

function pCare(m, no) {
  const ct = m.contacts || {};
  const blank = '____________';
  const val = (k) => (ct[k] ? E(ct[k]) : blank);
  const a = card('What this report cannot do', '<p style="margin:6px 0 0;font-size:15.5px;line-height:1.5;color:#2E3470">It does not show which students need help. No names and no individual results appear here, and a group picture on its own cannot show that any student is in difficulty.</p>', '#F1EEFB');
  const b = card('How an individual student gets support', ul(['Tell students how they can see their own Santulan report and how to ask for support from the right person at your school.', 'If you are worried about a student, speak to your school counsellor or student-safety lead. Do not wait for this report.',
    'Concerns about a student’s safety are handled privately and shared only with the appropriate people when necessary, under your school’s safeguarding and child-protection procedures. No one can promise absolute confidentiality where a child’s safety is at stake.'], 14.5), '#FBEFE9', '#9A3412');
  const ver = m.helpline_verified;
  const c = card('Helplines in India', ul([`Tele-MANAS: 14416, free mental-health helpline. Verified ${HELPLINE_TELEMANAS_VERIFIED}.`, `Childline: 1098, for children who need care or protection. ${ver ? `Verified on ${E(ver)}.` : 'To be verified before release.'}`,
    'Check that these are right for your area before you print or share this page.'], 14.5), '#E8F5EE', '#1F6B4A');
  const d = card('Your school’s contacts', `<div style="font-size:14.5px;line-height:2.1;color:#2E3470">School counsellor: ${val('counsellor')}<br>Student-safety lead: ${val('safety_lead')}<br>School contact for this report: ${val('school_contact')}<br>If urgent, we will: ${val('escalation')}</div>`, '#fff', '#5A4BA8', 'border:1.5px solid #E5E1F7');
  const e = card('Talking with students about results', ul(['Say what the questionnaire is: a picture of how students see themselves today, which can change.', 'Invite their views: what feels true, what surprises them, what would help.', 'Do not single out, guess about, or look for individual students from a group picture.', 'Do not use it to label a class, judge a student, or compare sections.'], 14.5), '#FBF3DC', '#7A5A00');
  const inner = head('LOOKING AFTER EVERY STUDENT', 'Care comes first') + `<div style="position:absolute;left:64px;right:64px;top:214px;display:flex;flex-direction:column;gap:10px">${a}${b}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${c}${d}</div>${e}</div>`;
  return frame(m, inner, no);
}

function pSnapshot(m, no) {
  const S = m.stats; let cards = '';
  for (const k of ORDER) {
    const c = clusterOf(k); const s = S[k]; let core;
    if (s.scored) {
      core = `<div style="font-size:34px;font-weight:800;color:${c.fg};line-height:1.1">${f1(s.avg)}</div><div style="font-size:13px;color:#4B5563">students’ average self-rating (1 to 5)</div>`
        + `<div style="font-size:14px;margin-top:6px;color:#2E3470">Middle half of students: <b>${f1(s.q1)} to ${f1(s.q3)}</b></div><div style="font-size:14px;color:#2E3470">Students with a number: <b>${s.n}</b> of ${m.N}</div>`;
    } else core = `<div style="font-size:15px;margin-top:6px;color:#2E3470">Not enough data yet: fewer than ${MINN} students have a number.</div>`;
    cards += `<div style="border:1.5px solid #E5E1F7;border-radius:16px;padding:12px 16px;height:178px;overflow:hidden"><div style="display:flex;gap:8px;align-items:center"><span style="font-size:12px;font-weight:800;padding:2px 8px;border-radius:7px;background:${c.bg};color:${c.fg}">${k}</span><b style="font-size:15px;line-height:1.2">${E(DOM[k].name)}</b></div>${core}`
      + `<div style="font-size:12.5px;color:#4B5563;margin-top:4px">${s.complete} Complete &middot; ${s.early} Early estimate &middot; ${s.none} Not enough data yet</div></div>`;
  }
  const inner = head('SEVEN CAPABILITY SNAPSHOTS', 'Seven separate pictures')
    + `<div style="position:absolute;left:64px;right:64px;top:214px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${cards}</div>`
    + `<p style="position:absolute;left:64px;right:64px;top:1010px;margin:0;font-size:14px;line-height:1.45;font-style:italic;color:#2E3470">${E(CAPTION)}</p>`;
  return frame(m, inner, no);
}

function pStyle(m, no) {
  const cols = [['ext', 'Mostly the two ends'], ['mid', 'Mostly the middle'], ['same', 'Same answer all through']];
  const keep = cols.filter(([kk]) => ORDER.some((k) => m.style[k][kk] >= MINN));
  let rows = '';
  for (const k of ORDER) {
    const st = m.style[k]; const s = m.stats[k];
    const f = (n) => (st.n ? hide(n) : '–');
    rows += `<tr><td>${E(DOM[k].name)}</td>${keep.map(([kk]) => `<td>${f(st[kk])}</td>`).join('')}<td>${s.time ? `${f1(s.time)} min` : '–'}</td></tr>`;
  }
  const tt = [...m.t_total.values()].sort((a, b) => a - b); const med = tt.length >= MINN ? median(tt) : null;
  let tp;
  if (med) {
    const fast = tt.filter((t) => t < med * COHORT.FAST_RATIO).length; const slow = tt.filter((t) => t > med * COHORT.SLOW_RATIO).length;
    const edges = [0, 10, 20, 30, 40, 50, 60, 1e9]; const names = ['Under 10', '10 to 19', '20 to 29', '30 to 39', '40 to 49', '50 to 59', '60 or more'];
    const cnt = []; for (let i = 0; i < 7; i += 1) cnt.push(tt.filter((t) => edges[i] <= t && t < edges[i + 1]).length);
    const mx = Math.max(...cnt) || 1;
    const hist = cnt.map((c) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;height:100%"><span style="font-size:12px;font-weight:700">${0 < c && c < MINN ? hide(c) : c}</span><div style="width:100%;height:${Math.max(2, rnd((100.0 * c) / mx))}%;border-radius:5px 5px 0 0;background:#5A4BA8"></div></div>`).join('');
    const labs = names.map((n) => `<span style="flex:1;text-align:center;font-size:11px;color:#4B5563">${n}</span>`).join('');
    const basis = m.time_basis === 'measured' ? 'Time is the sum of time spent on each question.' : 'Time is the span from first to last answer, so it includes any pauses.';
    tp = '<h2 style="margin:34px 0 0;font-size:22px;font-weight:800">Time taken to finish, in minutes</h2>'
      + `<p style="margin:6px 0 0;font-size:15px;line-height:1.55;color:#2E3470">The median is <b>${f0(med)} minutes</b> (${tt.length} students). ${basis} Very quick means under a third of the median: ${hide(fast)} students. Very slow means more than two and a half times the median: ${hide(slow)} students.</p>`
      + `<div style="display:flex;gap:6px;height:120px;margin-top:12px">${hist}</div><div style="display:flex;gap:6px;margin-top:4px">${labs}</div>`;
  } else tp = `<p style="margin:30px 0 0;font-size:15px">Time taken is not shown because fewer than ${MINN} students have a recorded time.</p>`;
  const nokeep = keep.length ? '' : `<p style="margin:0 0 14px;font-size:15px;line-height:1.55"><b>No unusual answer patterns to report.</b> In no capability did ${MINN} or more students answer mostly with the two ends, mostly with the middle, or with the same answer all through.</p>`;
  const inner = head('HOW STUDENTS ANSWERED', 'Background for reading<br>the numbers')
    + `<div style="position:absolute;left:64px;right:64px;top:238px"><p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#2E3470">These are response-pattern indicators. They show how students used the scale. They do not show that any student answered carelessly or dishonestly, and they are not about ability. The limits used are pilot thresholds. Counts are students; any count under ${MINN} is not shown.</p>`
    + `${nokeep}<table class="snap"><thead><tr><th>Capability</th>${keep.map(([, lb]) => `<th>${lb}</th>`).join('')}<th>Median time</th></tr></thead><tbody>${rows}</tbody></table>${tp}</div>`;
  return frame(m, inner, no);
}

function pNotes(m, no) {
  const cf = m.cfg_used;
  const items = [['Scores and averages', `Students rated each statement from 1 (${ANCHORS[0]}) to 5 (${ANCHORS[ANCHORS.length - 1]}). A capability number is the plain mean of a student’s answers in that capability, so every question counts equally and sub-areas with more questions weigh more. The group average is the mean of the student numbers. This weighting is a pilot choice, flagged for psychometric review.`],
    ['Answer direction', directionText(m)],
    ['Status of a student’s capability (pilot scoring rule, subject to psychometric review)', `Complete: no answers missing. Early estimate: some answers missing, fewer than ${rnd(cf['CFG-01'] * 100)}%. Not enough data yet: ${rnd(cf['CFG-01'] * 100)}% or more missing, or too few questions for that capability. Students in the last group have no number.`],
    ['Ranges', 'Ranges such as 3.0 to 3.9 only show how answers are spread. They are not performance levels, grades, stages or categories, and they are not cut-offs.'],
    ['Age bands', `This questionnaire form covers ages ${bandText(m.form)}. Bands are shown only when every band has at least ${MINN} students, and only descriptively. Differences between age groups are not interpreted without age-comparison evidence.`],
    ['Who is included', 'Students whose consent is verified, who have not withdrawn, and whose report was released as normal. Reports held for review and questionnaires that could not be processed add nothing to any figure.']];
  const body = items.map(([a, b]) => `<div style="margin-top:14px"><b style="font-size:15px;color:#1E2350">${E(a)}</b><p style="margin:2px 0 0;font-size:14.5px;line-height:1.55;color:#2E3470">${E(b)}</p></div>`).join('');
  return frame(m, head('NOTES ON READING THIS REPORT', 'How the numbers<br>were made') + `<div style="position:absolute;left:64px;right:64px;top:240px">${body}</div>`, no);
}

function verTable(m) {
  const d = new Date();
  const today = fdate(d);
  const ver = [['Questionnaire', m.versions.questionnaire.join(', ')], ['Scoring', m.versions.scoring.join(', ')], ['Report template', REPORT_VERSION], ['Language', m.locale], ['Release date', today], ['Evidence status', EVIDENCE_STATUS], ['Input file fingerprint', m.sha.slice(0, 12)]];
  return `<table class="snap"><tbody>${ver.map(([a, b]) => `<tr><td style="font-weight:700;width:190px">${E(a)}</td><td>${E(b)}</td></tr>`).join('')}</tbody></table>`;
}

function pNotes2(m, no) {
  const items = [['Sub-areas', `${subNoteLine(m)} A student has a sub-area number when at least ${SUB_MIN_ANSWERED} of its questions are answered, and a sub-area is shown only when ${MINN} or more students have one. Each rests on only a few questions. Sub-areas are chosen because a school can see them in daily life; they are never put in order of size. Others are not reported.`],
    ['Response patterns', 'Mostly the two ends, mostly the middle and the same answer all through are response-pattern indicators. They show how students used the scale. They do not show that a student answered carelessly or dishonestly, and no student is labelled. The 70%, 60% and 90% limits are pilot thresholds.'],
    ['Smallest group and privacy', `No average, range or age-band figure is shown for fewer than ${MINN} students, and pattern counts under ${MINN} are not shown. Counts of records at each step of the participant flow describe processing, not students’ answers, and are shown; breakdowns of exclusions under ${MINN} are not. Even so, people who know the students may guess who is behind a figure in a small group, so this report is for authorised users only.`],
    ['Change over time', 'This is a first round, a baseline. When students answer again, compare the same capability over time and say how many students answered both times. A change does not by itself show that an action caused it.']];
  const body = items.map(([a, b]) => `<div style="margin-top:16px"><b style="font-size:15px;color:#1E2350">${E(a)}</b><p style="margin:2px 0 0;font-size:14.5px;line-height:1.55;color:#2E3470">${E(b)}</p></div>`).join('');
  return frame(m, head('NOTES ON READING THIS REPORT', 'More about the<br>numbers') + `<div style="position:absolute;left:64px;right:64px;top:240px">${body}<h2 style="margin:22px 0 6px;font-size:18px;font-weight:800">Version record</h2>${verTable(m)}</div>`, no);
}

function pTech(m, no) {
  const rows = ORDER.map((k) => `<tr><td>${E(DOM[k].name)}</td><td>${m.item_table[k].admin}</td><td>${m.item_table[k].scored}</td><td>${m.item_table[k].held}</td><td>${m.sub[k].filter((r) => r.shown).length}</td></tr>`).join('');
  const t1 = `<table class="snap"><thead><tr><th>Capability</th><th>Questions asked</th><th>Questions scored</th><th>Held back</th><th>Sub-areas reported</th></tr></thead><tbody>${rows}</tbody></table>`;
  const th = PILOT_THRESHOLDS.map(([a, b, c]) => `<tr><td>${E(a)}</td><td>${E(b)}</td><td>${E(c)}</td></tr>`).join('');
  const t2 = `<table class="snap"><thead><tr><th>Rule</th><th>Value</th><th>Status</th></tr></thead><tbody>${th}</tbody></table>`;
  const inner = head('TECHNICAL NOTES', 'Counts and pilot rules')
    + `<div style="position:absolute;left:64px;right:64px;top:216px"><h2 style="margin:0 0 6px;font-size:18px;font-weight:800">Questions held back</h2>${t1}<p style="margin:6px 0 0;font-size:14px;color:#4B5563">Held-back questions are not scored and are left out of every figure, for every institution in this pilot.</p>`
    + `<h2 style="margin:20px 0 6px;font-size:18px;font-weight:800">Pilot rules in this report</h2>${t2}</div>`;
  return frame(m, inner, no);
}

function pGloss(m, no) {
  const rows = GLOSS.map(([a, b]) => `<div style="margin-top:11px"><b style="font-size:15px;color:#1E2350">${E(a)}</b><div style="font-size:14.5px;line-height:1.5;color:#2E3470">${E(b)}</div></div>`).join('');
  let final;
  if (m.draft) {
    const bl = m.blockers || [];
    final = `This copy is a draft. It must be previewed by a person and released under the institution’s sharing grant before it is shared.${bl.length ? `<br><b>Release blockers:</b> ${E(bl.join('; '))}.` : ''}`;
  } else final = `Approved for release by ${E(m.approved_by)}. Sharing grant: ${E(m.grant)}.`;
  const inner = head('WORDS USED IN THIS REPORT', 'Plain meanings') + `<div style="position:absolute;left:64px;right:64px;top:232px">${rows}`
    + '<p style="margin:20px 0 0;font-size:16px;line-height:1.55;color:#2E3470">Every student counts, and every capability can grow. This report describes a group today. It does not say what any student can or cannot do.</p>'
    + `<div class="card" style="margin-top:16px;background:#F1EEFB"><b class="k" style="color:#5A4BA8">Release record</b><div style="font-size:13.5px">${final}</div></div></div>`;
  return frame(m, inner, no);
}

// ---------------------------------------------------------------------------------------------------- build / document
function build(m) {
  const seq = [['cover', null, null, null, 0], ['limits', null, 'What this report is, and is not', null, 0], ['first', null, 'Key insights', null, 0], ['contents', null, null, null, 0], ['about2', null, 'How the questionnaire is built', null, 0],
    ['howto', null, 'How to read this report', null, 0], ['summary', null, 'Summary for leaders', null, 0], ['took', null, 'Who took part', null, 0], ['seven', null, 'The seven capabilities', null, 0],
    ['divider', ['PART 2', 'The seven capabilities', 'One capability at a time: what we see in the group, how sure we can be, and what sits inside it.'], 'Part 2 · The seven capabilities', null, 1]];
  for (const k of ORDER) { seq.push(['capA', k, DOM[k].name, k, 2]); seq.push(['capB', k, `Inside ${k} · sub-areas, ideas, questions`, k, 3]); }
  seq.push(['divider', ['PART 3', 'From picture to decisions', 'Choosing what to do, looking after every student, and the background to the numbers.'], 'Part 3 · From picture to decisions', null, 1],
    ['decide', null, 'Deciding what to do', null, 0], ['care', null, 'Looking after every student', null, 0], ['snap', null, 'Seven capability snapshots', null, 0], ['style', null, 'Background for reading the numbers', null, 0],
    ['notes', null, 'How the numbers were made', null, 0], ['notes2', null, 'More about the numbers', null, 0], ['tech', null, 'Technical notes', null, 0], ['gloss', null, 'Words used in this report', null, 0]);
  const toc = [];
  seq.forEach(([, , title, , lvl], i) => {
    if (title && [0, 1, 2].includes(lvl)) toc.push([lvl !== 2 ? String(toc.length + 1).padStart(2, '0') : '', title, i + 1, lvl !== 2 ? null : 'sub']);
  });
  const F = {
    cover: () => pCover(m), first: (no) => pFirst(m, no), contents: (no) => pContents(m, no, toc), limits: (no) => pLimits(m, no), about2: (no) => pAbout2(m, no),
    howto: (no) => pHowto(m, no), summary: (no) => pSummary(m, no), took: (no) => pTook2(m, no), seven: (no) => pSeven(m, no),
    divider: (no, a) => pDivider(m, no, ...a), capA: (no, a) => pCapA(m, no, a), capB: (no, a) => pCapB(m, no, a), decide: (no) => pDecide(m, no), care: (no) => pCare(m, no),
    snap: (no) => pSnapshot(m, no), style: (no) => pStyle(m, no), notes: (no) => pNotes(m, no), notes2: (no) => pNotes2(m, no), tech: (no) => pTech(m, no), gloss: (no) => pGloss(m, no),
  };
  const pages = seq.map((x, i) => F[x[0]](i + 1, x[1]));
  return { pages, kinds: seq.map((x) => (x[0] === 'capA' || x[0] === 'capB' ? 'blocks' : x[0])) };
}

function document(m, pages) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Santulan Capability Development Report - Cohort summary - ${E(m.inst_name)}</title>${FONTS}<style>${CSS}${EXTRA_CSS}</style></head><body>${pages.join('')}</body></html>`;
}

module.exports = { build, document, CAPTION, ANCHORS };
