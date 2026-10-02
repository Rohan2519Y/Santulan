/*
 * Ported from the Santulan pilot kit's santulan_gen/generate.py: load_workbook_rules() (reads sheets 21_Config_Parameters
 * and 30_Domain_Display of rules/Santulan_Development_Reporting_MASTER_System_v2_2.xlsx) plus the module-level constants
 * generate.py defines itself (BAND_HIGH/BAND_LOW/MIN_ITEMS_PER_DOMAIN/CHANGE_EPS/ORDER - the kit's own comment marks these
 * "PROPOSED parameters not yet in sheet 21", i.e. not sourced from the workbook either, in the original).
 *
 * The workbook values are reproduced here as static data rather than re-read from the .xlsx at runtime: the workbook is
 * reference content the kit ships, not something that changes per request, and this keeps the port dependency-free until
 * PDF rendering (a real decision, not made yet) needs a headless browser.
 */

// sheet 21_Config_Parameters - only the entries generate.py actually reads (CFG-01, CFG-02, CFG-05, CFG-20..26)
const CFG = {
  'CFG-01': 0.2, // provisional score upper bound (missing share below this) -> MS02
  'CFG-02': 0.4, // no-score threshold (missing share at or above this) -> MS04
  'CFG-05': 30, // default review interval, days
  'CFG-20': '13–15', // band D1
  'CFG-21': '16–17', // band D2
  'CFG-22': '18–21', // band D3
  'CFG-23': '22–25', // band D4
  'CFG-24': 4, // domain blocks per detail page
  'CFG-25': 4, // maximum strength cards shown
  'CFG-26': 3, // maximum explore cards shown
};

// sheet 30_Domain_Display - key, student-facing name, cluster (A/B/C), live subdomain count, meaning line, strength/explore
// card titles, and the goal this domain usually links to. (Separate from content.js's DOM, which holds authored wording -
// generate.py itself keeps these as two different dicts, DOM and C.DOM, for the same reason.)
const DOM = {
  C1: { key: 'C1', name: 'Body & Self-Regulation', cluster: 'A', subcount: 7, meaning: "How you notice and look after your body's signals, energy and rest.", strength_title: 'Listening to your body', explore_title: "Looking after your body's signals", goal: 'Health and energy' },
  C2: { key: 'C2', name: 'Emotional Capability', cluster: 'A', subcount: 11, meaning: 'How you notice, understand and handle your feelings.', strength_title: 'Noticing how you feel', explore_title: 'Making sense of your feelings', goal: 'Personal growth' },
  C3: { key: 'C3', name: 'Relational & Social Capability', cluster: 'B', subcount: 12, meaning: 'How you read, talk with and work alongside other people.', strength_title: 'Working with other people', explore_title: 'Handling tricky moments with others', goal: 'Friendships and teamwork' },
  C4: { key: 'C4', name: 'Identity & Self-Concept', cluster: 'B', subcount: 5, meaning: 'How you understand and describe who you are.', strength_title: 'A growing picture of yourself', explore_title: 'Understanding who you are', goal: 'Personal growth' },
  C5: { key: 'C5', name: 'Values, Purpose & Future Agency', cluster: 'C', subcount: 7, meaning: 'What matters to you and how you steer towards your future.', strength_title: 'Knowing what matters to you', explore_title: 'Connecting today to what matters', goal: 'Plans for my future' },
  C6: { key: 'C6', name: 'Adaptability & Resilience', cluster: 'C', subcount: 10, meaning: 'How you adjust and bounce back when things change or go wrong.', strength_title: 'Adjusting and bouncing back', explore_title: 'Adjusting when plans change', goal: 'Personal growth' },
  C7: { key: 'C7', name: 'Self-Directed Learning & Executive Capability', cluster: 'C', subcount: 20, meaning: 'How you plan, start, focus and steer your own learning.', strength_title: 'Steering your own learning', explore_title: 'Turning intentions into a first step', goal: 'Studies' },
};

// PROPOSED, not yet in sheet 21 (verbatim comment from generate.py)
const BAND_HIGH = 3.6;
const BAND_LOW = 3.0; // per-domain absolute cut points; never used to rank domains against each other
const MIN_ITEMS_PER_DOMAIN = 5; // PROPOSED (OD-17): a form with fewer items in a domain cannot support a domain result
const CHANGE_EPS = 0.2; // differences below this are described as "about the same"
const ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']; // fixed order everywhere (the kit's MP20)

function msState(share) {
  if (share === 0) return 'MS01';
  if (share < CFG['CFG-01']) return 'MS02';
  if (share < CFG['CFG-02']) return 'MS03';
  return 'MS04';
}

function ageBand(age) {
  const bands = [['D1', 'CFG-20'], ['D2', 'CFG-21'], ['D3', 'CFG-22'], ['D4', 'CFG-23']];
  for (const [band, key] of bands) {
    const [lo, hi] = CFG[key].split(/[–-]/).map(Number);
    if (age >= lo && age <= hi) return band;
  }
  throw new RangeError('age outside 13-25: not eligible for this instrument');
}

function pctPhrase(share) {
  const p = Math.round((1 - share) * 100);
  return p >= 45 && p <= 55 ? 'about half' : `about ${p}%`;
}

module.exports = { CFG, DOM, BAND_HIGH, BAND_LOW, MIN_ITEMS_PER_DOMAIN, CHANGE_EPS, ORDER, msState, ageBand, pctPhrase };
