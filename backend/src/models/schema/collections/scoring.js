/* Quality and scoring collections (BUILD 01 section 6.12-6.13; scoring master; data-model section 3.4). */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, int, num, date, collection, isNull, notNull, implies, eq, inList, and, or } = D;

const qualityFlags = collection('quality_flags', 'B', {
  attempt_id: uuid(),
  domain_code: str({ enum: E.DOMAIN, nullable: true }),
  flag_code: str({ enum: E.FLAG_CODE }),
  severity: str({ enum: E.SEVERITY }),
  detected_at: date(),
  disposition: str({ enum: E.DISPOSITION }),
  reviewed_by: uuid({ nullable: true }),
  reviewed_at: date({ nullable: true }),
  review_note: str({ nullable: true }),
}, [
  or(and(isNull('$reviewed_by'), isNull('$reviewed_at')), and(notNull('$reviewed_by'), notNull('$reviewed_at'))), // quality_review_ck
  implies(eq('$flag_code', 'Q09'), eq('$severity', 'CRITICAL')), // q09_critical_ck
]);

// Exact integer arithmetic (scoring master, RC0): valid x 100 against 60 / 80 x eligible; no floating point.
const v100 = { $multiply: ['$valid_items', 100] };
const expectedStatus = {
  $switch: {
    branches: [
      { case: { $lte: [v100, { $multiply: ['$eligible_items', 60] }] }, then: 'INSUFFICIENT' },
      { case: { $lte: [v100, { $multiply: ['$eligible_items', 80] }] }, then: 'INCOMPLETE' },
      { case: { $lt: ['$valid_items', '$eligible_items'] }, then: 'COMPLETE_WITH_MISSING' },
    ],
    default: 'COMPLETE',
  },
};

const scoreResults = collection('score_results', 'A', {
  attempt_id: uuid(),
  participant_id: uuid(),
  assessment_version_id: uuid(),
  domain_code: str({ enum: E.DOMAIN }),
  raw_score: num({ min: 1, max: 5, nullable: true }),
  completeness_rate: num({ min: 0, max: 1 }),
  eligible_items: int({ min: 1 }),
  valid_items: int({ min: 0 }),
  completeness_status: str({ enum: E.COMPLETENESS }),
  score_status: str({ enum: E.EVIDENCE }),
  scoring_version: str({ nonblank: true }),
  calculated_at: date(),
}, [
  { $lte: ['$valid_items', '$eligible_items'] },
  // completeness_rate equals valid / eligible within the four stored decimals
  { $lte: [{ $abs: { $subtract: ['$completeness_rate', { $divide: ['$valid_items', '$eligible_items'] }] } }, 0.00006] },
  eq('$completeness_status', expectedStatus),
  // 60 % complete is INSUFFICIENT: no score, evidence S0 - all three together or none
  eq({ $eq: ['$completeness_status', 'INSUFFICIENT'] }, isNull('$raw_score')),
  eq({ $eq: ['$completeness_status', 'INSUFFICIENT'] }, { $eq: ['$score_status', 'S0'] }),
  // INCOMPLETE is never S2 or higher
  implies(eq('$completeness_status', 'INCOMPLETE'), inList('$score_status', ['S1', 'SH'])),
]);

module.exports = [qualityFlags, scoreResults];
