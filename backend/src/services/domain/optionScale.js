/*
 * Option scale (spec FR-014, research R-M08, CR-006-5). An answer is stored as the chosen option's POSITION. For scoring, the
 * options of a question are spread evenly over the common 1-5 scale:
 *
 *     value(position, n) = 1 + (position - 1) * 4 / (n - 1)
 *
 * so a 5-option question reproduces today's 1..5 exactly, 3 options give 1 / 3 / 5 and 2 options give 1 / 5. This default is
 * pending psychometric approval; evidence for a new set therefore starts at S1 (research only).
 */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 20;

/** @throws RangeError when n is not an integer 2..20 or position is not an integer 1..n */
function optionValue(position, optionCount) {
  if (!Number.isInteger(optionCount) || optionCount < MIN_OPTIONS || optionCount > MAX_OPTIONS) throw new RangeError(`optionCount must be an integer ${MIN_OPTIONS}..${MAX_OPTIONS}`);
  if (!Number.isInteger(position) || position < 1 || position > optionCount) throw new RangeError(`position must be an integer 1..${optionCount}`);
  return 1 + ((position - 1) * 4) / (optionCount - 1);
}

/** True when `value` (a string such as "3") is a valid position for a question with `optionCount` options. */
const isValidPosition = (value, optionCount) => /^[0-9]{1,2}$/.test(String(value)) && Number(value) >= 1 && Number(value) <= optionCount;

module.exports = { optionValue, isValidPosition, MIN_OPTIONS, MAX_OPTIONS };
