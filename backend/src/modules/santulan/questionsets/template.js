/* Blank template workbook (contracts/upload-format.md section 7): header + three example rows with the five standard options. */
const XLSX = require('xlsx');
const { REQUIRED_COLUMNS, SHEET } = require('./questionSetParser');

const EN = '–';
const STANDARD = ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'];
const LABEL = 'example-adolescent-v1';

const EXAMPLES = [
  ['C1-01', LABEL, 'C1', 'Body & Self-Regulation', 'C1.1', 'Interoceptive Awareness', 'I notice early signs in my body when I am getting tired or stressed.', 'Positive', `13${EN}25`, 'General', 'CORE', 'READY', 1],
  ['C2-01', LABEL, 'C2', 'Emotional Capability', 'C2.1', 'Emotion Awareness', 'I can tell what I am feeling while I am feeling it.', 'Positive', `13${EN}25`, 'General', 'CORE', 'READY', 2],
  ['C7-01', LABEL, 'C7', 'Self-Directed Learning & Executive Capability', 'C7A.5', 'Planning', 'I break a big task into smaller steps before I start it.', 'Positive', `13${EN}17`, 'School', 'CORE', 'READY', 3],
];

function buildTemplate() {
  const header = [...REQUIRED_COLUMNS, ...Array.from({ length: 10 }, (_, i) => `option_${i + 1}`)];
  const aoa = [header, ...EXAMPLES.map((r) => [...r, ...STANDARD, '', '', '', '', ''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildTemplate, TEMPLATE_FILE_NAME: 'santulan_question_set_template.xlsx' };
