/*
 * .xlsx rendering of questionSetService.responseDistribution's output (ASSUMED addition - no contract covers this report).
 * Two sheets sharing the same numbers:
 *   1. "Response distribution" - the plain, pivot-friendly table (one row per question/answer). Unchanged from before.
 *   2. "Chart view" - the same rows, but the Responses column carries Excel's native Data Bar conditional formatting
 *      (not a picture, not a chart object - SheetJS's free tier and exceljs both lack chart-object support; a data bar is
 *      the one bar-shaped visual either library can actually write) so each answer's bar length is directly comparable
 *      to the others, scaled 0..totalAttempts the same way across every question on the sheet.
 */
const ExcelJS = require('exceljs');

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function addDataSheet(workbook, distribution) {
  const { versionLabel, revision, ageGroup, totalAttempts, items } = distribution;
  const ws = workbook.addWorksheet('Response distribution');
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 60 }, { width: 22 }, { width: 40 }, { width: 11 }, { width: 14 }];

  ws.addRow(['Santulan — Response distribution']);
  ws.addRow([`Assessment: ${versionLabel} · revision ${revision} · ${ageGroup === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'}`]);
  ws.addRow([`Completed attempts (SUBMITTED or later): ${totalAttempts}`]);
  ws.addRow([`Generated: ${new Date().toISOString()}`]);
  ws.addRow([]);
  ws.addRow(['Item code', 'Domain', 'Question', 'Status', 'Answer', 'Responses', '% of completed attempts']);

  for (const item of items) {
    const status = item.status === 'RETIRED' ? 'Hidden from participants' : 'Shown to participants';
    for (const o of item.options) ws.addRow([item.itemCode, item.domainCode, item.questionText, status, o.text, o.count, pct(o.count, totalAttempts)]);
    ws.addRow([item.itemCode, item.domainCode, item.questionText, status, 'Skipped', item.skippedCount, pct(item.skippedCount, totalAttempts)]);
  }
}

function addChartSheet(workbook, distribution) {
  const { versionLabel, revision, ageGroup, totalAttempts, items } = distribution;
  const ws = workbook.addWorksheet('Chart view');
  ws.columns = [{ width: 12 }, { width: 22 }, { width: 60 }, { width: 45 }];

  ws.addRow(['Santulan — Response distribution (visual)']);
  ws.addRow([`Assessment: ${versionLabel} · revision ${revision} · ${ageGroup === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'}`]);
  ws.addRow([`Completed attempts (SUBMITTED or later): ${totalAttempts} — every bar is scaled against this same total`]);
  ws.addRow([]);

  const barCol = 4; // column D holds the Responses count and its data bar
  let firstBarRow = null;
  let lastBarRow = null;

  for (const item of items) {
    const headRow = ws.addRow([`${item.itemCode} · ${item.domainCode}`, null, item.questionText, null]);
    headRow.font = { bold: true };
    ws.mergeCells(headRow.number, 1, headRow.number, 2);
    ws.mergeCells(headRow.number, 3, headRow.number, 4);

    for (const o of item.options) {
      const row = ws.addRow([null, o.text, null, o.count]);
      if (firstBarRow === null) firstBarRow = row.number;
      lastBarRow = row.number;
    }
    const skipRow = ws.addRow([null, 'Skipped', null, item.skippedCount]);
    lastBarRow = skipRow.number;
    ws.addRow([]); // spacer between questions
  }

  if (totalAttempts > 0 && firstBarRow) {
    ws.addConditionalFormatting({
      ref: `${ws.getColumn(barCol).letter}${firstBarRow}:${ws.getColumn(barCol).letter}${lastBarRow}`,
      rules: [{
        type: 'dataBar', priority: 1,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: totalAttempts }],
        color: { argb: 'FF638EC6' },
      }],
    });
  }
}

async function buildResponseDistributionWorkbook(distribution) {
  const workbook = new ExcelJS.Workbook();
  addDataSheet(workbook, distribution);
  addChartSheet(workbook, distribution);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildResponseDistributionWorkbook };
