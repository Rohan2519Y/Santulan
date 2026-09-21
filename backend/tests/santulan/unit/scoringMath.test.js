/* Scoring arithmetic (B06; SC-015, SC-016): the scoring master's worked examples, the boundary table, and the option-position rule. Pure. */
const { scoreDomain, completenessStatus, decideEvidence, round2 } = require('../../../src/modules/santulan/domain/scoringRules');
const { optionValue } = require('../../../src/modules/santulan/domain/optionScale');

const five = (positions) => positions.map((position) => ({ position, optionCount: 5 }));

describe('master worked examples A-D (SC-015)', () => {
  test('A: 8 eligible, answered 4,4,3,5,4,3,4,5 -> mean 4.00 COMPLETE', () => {
    expect(scoreDomain({ eligible: 8, answers: five([4, 4, 3, 5, 4, 3, 4, 5]) })).toEqual({ eligibleItems: 8, validItems: 8, completenessStatus: 'COMPLETE', completenessRate: 1, rawScore: 4 });
  });
  test('B: 10 eligible, 9 valid 4,3,5,4,4,3,4,5,4 -> completeness 0.9, sum 36, mean 4.00 COMPLETE_WITH_MISSING (no imputation)', () => {
    const r = scoreDomain({ eligible: 10, answers: five([4, 3, 5, 4, 4, 3, 4, 5, 4]) });
    expect(r).toEqual({ eligibleItems: 10, validItems: 9, completenessStatus: 'COMPLETE_WITH_MISSING', completenessRate: 0.9, rawScore: 4 });
  });
  test('C: 8 of 10 answered -> completeness 0.8 INCOMPLETE, score kept for research', () => {
    const r = scoreDomain({ eligible: 10, answers: five([5, 5, 5, 5, 5, 5, 5, 5]) });
    expect(r).toMatchObject({ validItems: 8, completenessStatus: 'INCOMPLETE', completenessRate: 0.8, rawScore: 5 });
  });
  test('D: 6 of 10 answered -> completeness 0.6 INSUFFICIENT, no score', () => {
    const r = scoreDomain({ eligible: 10, answers: five([3, 3, 3, 3, 3, 3]) });
    expect(r).toMatchObject({ validItems: 6, completenessStatus: 'INSUFFICIENT', completenessRate: 0.6, rawScore: null });
  });
  test('nothing answered is INSUFFICIENT with no score (never a score of 1)', () => {
    expect(scoreDomain({ eligible: 10, answers: [] })).toMatchObject({ validItems: 0, completenessStatus: 'INSUFFICIENT', rawScore: null, completenessRate: 0 });
  });
});

describe('B06-011..015 the boundary table is exact integer arithmetic', () => {
  test.each([
    [10, 10, 'COMPLETE'], [9, 10, 'COMPLETE_WITH_MISSING'], [8, 10, 'INCOMPLETE'], [7, 10, 'INCOMPLETE'], [6, 10, 'INSUFFICIENT'], [0, 10, 'INSUFFICIENT'],
    [4, 5, 'INCOMPLETE'], [3, 5, 'INSUFFICIENT'], [5, 8, 'INCOMPLETE'], [6, 8, 'INCOMPLETE'], [7, 8, 'COMPLETE_WITH_MISSING'], [1, 1, 'COMPLETE'], [1, 2, 'INSUFFICIENT'],
    [61, 100, 'INCOMPLETE'], [60, 100, 'INSUFFICIENT'], [80, 100, 'INCOMPLETE'], [81, 100, 'COMPLETE_WITH_MISSING'],
  ])('%i of %i -> %s', (valid, eligible, status) => {
    expect(completenessStatus(valid, eligible)).toBe(status);
  });
  test('exactly 60 percent is INSUFFICIENT and exactly 80 percent is INCOMPLETE, whatever the size of the domain', () => {
    for (const eligible of [5, 10, 15, 20, 25, 50, 100]) {
      expect(completenessStatus((eligible * 60) / 100, eligible)).toBe('INSUFFICIENT');
      expect(completenessStatus((eligible * 80) / 100, eligible)).toBe('INCOMPLETE');
    }
  });
  test('invalid inputs are refused', () => {
    expect(() => completenessStatus(11, 10)).toThrow(RangeError);
    expect(() => completenessStatus(-1, 10)).toThrow(RangeError);
    expect(() => completenessStatus(0, 0)).toThrow(RangeError);
    expect(() => completenessStatus(1.5, 10)).toThrow(RangeError);
  });
});

describe('B06-070 the option-position rule inside a domain mean', () => {
  test('mixed option counts: a 3-option last answer, a 2-option last answer and a 5-option last answer all count as 5', () => {
    const r = scoreDomain({ eligible: 3, answers: [{ position: 3, optionCount: 3 }, { position: 2, optionCount: 2 }, { position: 5, optionCount: 5 }] });
    expect(r.rawScore).toBe(5);
    expect(scoreDomain({ eligible: 3, answers: [{ position: 1, optionCount: 3 }, { position: 1, optionCount: 2 }, { position: 1, optionCount: 20 }] }).rawScore).toBe(1);
  });
  test('the middle of 3 options and the middle of 9 options both count as 3', () => {
    expect(scoreDomain({ eligible: 2, answers: [{ position: 2, optionCount: 3 }, { position: 5, optionCount: 9 }] }).rawScore).toBe(3);
  });
  test('the mean is rounded to two decimals, half up, without floating point drift', () => {
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(4)).toBe(4);
    // 4 options: values 1, 2.333.., 3.666.., 5
    expect(scoreDomain({ eligible: 3, answers: [{ position: 2, optionCount: 4 }, { position: 3, optionCount: 4 }, { position: 4, optionCount: 4 }] }).rawScore).toBe(3.67);
  });
  test('every score is inside 1.00-5.00 and equals the mean of the position values (2, 3, 5, 9, 20 options)', () => {
    for (const n of [2, 3, 5, 9, 20]) {
      const answers = Array.from({ length: n }, (_, i) => ({ position: i + 1, optionCount: n }));
      const r = scoreDomain({ eligible: n, answers });
      expect(r.rawScore).toBeGreaterThanOrEqual(1);
      expect(r.rawScore).toBeLessThanOrEqual(5);
      expect(r.rawScore).toBe(3); // an even spread of positions averages to the midpoint of the scale
      expect(optionValue(1, n)).toBe(1);
    }
  });
});

describe('evidence decision keeps the score and the state apart', () => {
  test('the score never depends on the switches', () => {
    expect(scoreDomain({ eligible: 2, answers: five([4, 4]) }).rawScore).toBe(4);
    expect(decideEvidence('C1', 'COMPLETE', {}, {})).toBe('S1');
    expect(decideEvidence('C1', 'COMPLETE', {}, { pilotS2: true })).toBe('S2');
  });
});
