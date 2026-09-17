/*
 * One-off conversion of the TECH_READY xlsx pools into JSON fixtures, run via
 * `node seeders/build-fixtures.js`. Re-run only if docs/*.xlsx change; the
 * seeder itself consumes the committed JSON under seeders/seeds/.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseItemPoolRows } = require('../src/modules/assessment/utils/itemPoolParser');

const SOURCES = [
  {
    file: path.join(__dirname, '..', '..', 'docs', 'Santulan_Adolescent_Items_TECH_READY.xlsx'),
    outDir: path.join(__dirname, 'seeds', 'item-pool-adolescent'),
  },
  {
    file: path.join(__dirname, '..', '..', 'docs', 'Santulan_EmergingAdult_Items_TECH_READY.xlsx'),
    outDir: path.join(__dirname, 'seeds', 'item-pool-emergingadult'),
  },
];

for (const { file, outDir } of SOURCES) {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.includes('01_Items') ? '01_Items' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  const { validItems, errors, versionLabel } = parseItemPoolRows(rows);

  if (errors.length > 0) {
    console.error(`Validation errors for ${file}:`, errors); // eslint-disable-line no-console
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'items.json'),
    JSON.stringify({ sourceFile: path.basename(file), versionLabel, items: validItems }, null, 2)
  );
  console.log(`${path.basename(file)}: wrote ${validItems.length} items to ${outDir}`); // eslint-disable-line no-console
}
