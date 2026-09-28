/* Sheet partitioning (B08-042, 043, 047, AT-28): 1,048,575 data rows per sheet (Excel's 1,048,576 including the header). Pure functions. */
const { MAX_ROWS, sheetCount, partition } = require('../../../src/services/research/partition');

describe('sheet count', () => {
  test('MAX_ROWS is 1,048,575 and the boundary values give 1, 2 and 3 sheets', () => {
    expect(MAX_ROWS).toBe(1048575);
    expect(sheetCount(1048575)).toBe(1);
    expect(sheetCount(1048576)).toBe(2);
    expect(sheetCount(2220000)).toBe(3);
  });

  test('ceil(rows / MAX_ROWS) across the boundaries; an empty data set still has the one ITEM_RESPONSES_LONG_01 sheet', () => {
    expect(sheetCount(0)).toBe(1);
    expect(sheetCount(1)).toBe(1);
    expect(sheetCount(2 * MAX_ROWS)).toBe(2);
    expect(sheetCount(2 * MAX_ROWS + 1)).toBe(3);
    expect(sheetCount(3 * MAX_ROWS)).toBe(3);
  });
});

describe('partition ranges', () => {
  const check = (rows) => {
    const ranges = partition(rows);
    expect(ranges).toHaveLength(sheetCount(rows));
    let expectedStart = 0;
    for (const [from, to] of ranges) {
      expect(from).toBe(expectedStart); // contiguous: no duplicate and no omission at adjacent boundaries
      expect(to).toBeGreaterThanOrEqual(from);
      expect(to - from).toBeLessThanOrEqual(MAX_ROWS);
      expect(to - from + 1).toBeLessThanOrEqual(1048576); // data rows plus the header never exceed Excel's limit
      expectedStart = to;
    }
    expect(expectedStart).toBe(rows); // together the ranges cover every row exactly once
    return ranges;
  };

  test.each([0, 1, 1000, 1048574, 1048575, 1048576, 1048577, 2097150, 2097151, 2220000, 5000000])('%i rows are covered exactly once with no oversized sheet', (rows) => { check(rows); });

  test('the 2,220,000-row case (10,000 x 222) is three sheets: 1,048,575 + 1,048,575 + 122,850', () => {
    expect(check(2220000)).toEqual([[0, 1048575], [1048575, 2097150], [2097150, 2220000]]);
  });

  test('exactly one full sheet needs no second sheet; one more row opens the second', () => {
    expect(check(1048575)).toEqual([[0, 1048575]]);
    expect(check(1048576)).toEqual([[0, 1048575], [1048575, 1048576]]);
  });
});
