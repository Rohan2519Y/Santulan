/*
 * Sheet partitioning for the research workbook (B08-042, 043, 047). Excel holds 1,048,576 rows per sheet including the header row,
 * so a sheet carries at most 1,048,575 data rows; a larger data set continues on the next ITEM_RESPONSES_nn sheet. Pure functions.
 */
const MAX_ROWS = 1048575;

/** Number of sheets for `rows` data rows: ceil(rows / MAX_ROWS), and always at least one so the workbook layout never changes. */
const sheetCount = (rows) => Math.max(1, Math.ceil(rows / MAX_ROWS));

/** The [from, to) row ranges each sheet holds: contiguous, no gap, no overlap, none above MAX_ROWS. */
function partition(rows) {
  const ranges = [];
  for (let start = 0; ranges.length === 0 || start < rows; start += MAX_ROWS) ranges.push([start, Math.min(rows, start + MAX_ROWS)]);
  return ranges;
}

module.exports = { MAX_ROWS, sheetCount, partition };
