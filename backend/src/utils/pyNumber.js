/*
 * Number formatting that matches Python's, for the ports of the pilot kit's report generators.
 *
 * Python's round() and '%.Nf' round an EXACT tie (a value whose binary form sits exactly halfway, such as 3.25 at one
 * decimal, 0.125 at two, or 2.5 at none) to the EVEN neighbour: 3.25 -> 3.2, 2.5 -> 2. JavaScript's toFixed()/Math.round()
 * round those ties up (3.3, 3). Both agree everywhere else (toFixed uses the exact binary value, like Python). Averages
 * of 2-decimal means land on exact .25/.75 ties often enough that a printed "3.3" vs "3.2" would differ from the kit.
 */

/** x = mant * 2^exp exactly, mant a BigInt (x finite, non-negative). */
function decompose(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0); const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (biased === 0) return { mant, exp: -1074 };
  mant |= 1n << 52n;
  return { mant, exp: biased - 1075 };
}

/** True when |x| * 10^nd is exactly an integer plus one half. */
function isExactTie(x, nd) {
  const { mant, exp } = decompose(Math.abs(x));
  // x * 10^nd * 2 must be an odd integer
  const t = mant * (10n ** BigInt(nd));
  const shift = exp + 1;
  if (shift >= 0) return nd === 0 && shift === 0 && (mant & 1n) === 1n;
  const k = BigInt(-shift);
  if (t % (1n << k) !== 0n) return false;
  return ((t >> k) & 1n) === 1n;
}

/** Python's '%.{nd}f' % x. */
function pyFixed(x, nd = 0) {
  if (!Number.isFinite(x)) return String(x);
  const s = x.toFixed(nd);
  if (!isExactTie(x, nd)) return s;
  const y = Math.abs(x) * (10 ** nd); // exact: the tie value k + 0.5 is representable
  const n = Math.floor(y);
  const chosen = n % 2 === 0 ? n : n + 1;
  return `${x < 0 ? '-' : ''}${(chosen / (10 ** nd)).toFixed(nd)}`;
}

/** Python's round(x, nd) as a number (nd = 0 gives an integer). */
const pyRound = (x, nd = 0) => Number(pyFixed(x, nd));

module.exports = { pyFixed, pyRound };
