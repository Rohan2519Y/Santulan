/* Option scale (spec FR-014, SC-016; B06 arithmetic): value(position, n) = 1 + (position - 1) * 4 / (n - 1). Pure. */
const { optionValue, isValidPosition } = require('../../../src/modules/santulan/domain/optionScale');

describe('B06-070 position -> value on the common 1-5 scale', () => {
  test('a 5-option question reproduces 1, 2, 3, 4, 5 exactly (identical to today)', () => {
    expect([1, 2, 3, 4, 5].map((p) => optionValue(p, 5))).toEqual([1, 2, 3, 4, 5]);
  });
  test('3 options give 1 / 3 / 5; 2 options give 1 / 5', () => {
    expect([1, 2, 3].map((p) => optionValue(p, 3))).toEqual([1, 3, 5]);
    expect([1, 2].map((p) => optionValue(p, 2))).toEqual([1, 5]);
  });
  test('4, 9 and 20 options are evenly spaced from 1 to 5', () => {
    expect([1, 2, 3, 4].map((p) => optionValue(p, 4))).toEqual([1, 1 + 4 / 3, 1 + 8 / 3, 5]);
    expect(optionValue(1, 9)).toBe(1);
    expect(optionValue(5, 9)).toBe(3);
    expect(optionValue(9, 9)).toBe(5);
    expect(optionValue(1, 20)).toBe(1);
    expect(optionValue(20, 20)).toBe(5);
    expect(optionValue(11, 20)).toBeCloseTo(1 + (10 * 4) / 19, 12);
  });
  test('every value is inside 1..5 and strictly increasing with the position, for every n from 2 to 20', () => {
    for (let n = 2; n <= 20; n += 1) {
      let prev = 0;
      for (let p = 1; p <= n; p += 1) {
        const v = optionValue(p, n);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
      expect(optionValue(1, n)).toBe(1);
      expect(optionValue(n, n)).toBe(5);
    }
  });
  test('an out-of-range position or option count throws', () => {
    expect(() => optionValue(0, 5)).toThrow(RangeError);
    expect(() => optionValue(6, 5)).toThrow(RangeError);
    expect(() => optionValue(1.5, 5)).toThrow(RangeError);
    expect(() => optionValue(1, 1)).toThrow(RangeError);
    expect(() => optionValue(1, 21)).toThrow(RangeError);
    expect(() => optionValue(1, '5')).toThrow(RangeError);
  });
});

describe('isValidPosition', () => {
  test('accepts 1..n as a string of one or two digits, refuses everything else', () => {
    expect(isValidPosition('1', 3)).toBe(true);
    expect(isValidPosition('3', 3)).toBe(true);
    expect(isValidPosition('20', 20)).toBe(true);
    for (const bad of ['0', '4', '21', '', 'a', '1.5', '-1', '100', ' 1']) expect(isValidPosition(bad, 3)).toBe(false);
  });
});
