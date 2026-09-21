#!/usr/bin/env node
/*
 * Loads the reference content (feature 006, T040; BUILD 01 section 10 fail-closed seed): 216 development actions (all
 * `active = false`) and 72 reflection prompts (all `DRAFT`). It seeds NO question set and NO interpretation rule: questions
 * arrive only by spreadsheet upload, wording only through governed loading (scripts/wording-load.js).
 * Uses the migrator credential. Idempotent: existing rows (by action_code+library_version / prompt_code+version) are kept.
 *
 *   sources: docs/Santulan_Development_Reporting_MASTER_System_v1_1.xlsx
 *            sheets 07_Development_Action_Library (DAL-###) and 04_Subdomain_Master_Ref
 *   ASSUMED (D-11): library_version 'DRM-v1.1'; duration_minutes = the upper bound of the stated range.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const XLSX = require('xlsx');
const { v5: uuidv5 } = require('uuid');
const { MongoClient } = require('mongodb');

const DRM = path.resolve(__dirname, '..', '..', 'docs', 'Santulan_Development_Reporting_MASTER_System_v1_1.xlsx');
const LIBRARY_VERSION = 'DRM-v1.1';
const NAMESPACE = '5d3b7c0e-9a4f-4f1e-8a63-0c2d6b1f9e21'; // deterministic ids so a re-run inserts nothing new
const PROGRESSION = ['Foundation', 'Practice', 'Transfer'];

function sheetRows(wb, sheet) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`sheet ${sheet} not found in ${path.basename(DRM)}`);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const header = data[0].map((h) => String(h).trim());
  return data.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = typeof r[i] === 'string' ? r[i] : String(r[i] ?? ''); });
    return o;
  });
}

/** Builds the 216 action and 72 prompt documents from the workbook. Fails unless the counts and coverage are exact. */
function buildReference() {
  const wb = XLSX.readFile(DRM);
  const actionRows = sheetRows(wb, '07_Development_Action_Library').filter((r) => /^DAL-\d{3}$/.test(r['Action ID']));
  const subRows = sheetRows(wb, '04_Subdomain_Master_Ref').filter((r) => /^C\d/.test(r['Subdomain Code']));
  if (actionRows.length !== 216) throw new Error(`expected 216 actions, found ${actionRows.length}`);
  if (subRows.length !== 72) throw new Error(`expected 72 subdomain rows, found ${subRows.length}`);

  const subByAction = {};
  for (const s of subRows) for (const k of ['Foundation Action ID', 'Practice Action ID', 'Transfer Action ID']) subByAction[s[k]] = s;

  const now = new Date();
  const seen = new Set();
  const actions = actionRows.map((a) => {
    const s = subByAction[a['Action ID']];
    if (!s) throw new Error(`no subdomain for ${a['Action ID']}`);
    if (!PROGRESSION.includes(a.Progression)) throw new Error(`unknown progression on ${a['Action ID']}`);
    seen.add(`${s['Subdomain Code']}|${a.Progression}`);
    const m = String(a.Duration).match(/(\d+)\D+(\d+)/);
    return {
      _id: uuidv5(`${a['Action ID']}:${LIBRARY_VERSION}`, NAMESPACE),
      action_code: a['Action ID'],
      library_version: LIBRARY_VERSION,
      domain_code: s['Domain Code'],
      subdomain_code: s['Subdomain Code'],
      progression_level: a.Progression,
      action_text: a['Action Text'],
      age_band: a['Age Routing'].split(';')[0].trim(),
      action_type: a['Action Type'] || null,
      duration_minutes: m ? Number(m[2]) : null,
      practice_window: a['Practice Window'] || null,
      evidence_status: s['Evidence Status'],
      control_flags: { control: a.Control, level: a.Level, process: a.Process, age_routing: a['Age Routing'], duration_text: a.Duration },
      active: false,
      created_at: now,
    };
  });
  if (seen.size !== 216) throw new Error(`every subdomain x Foundation/Practice/Transfer pair must occur once; found ${seen.size} distinct pairs`);

  const prompts = subRows.map((s) => ({
    _id: uuidv5(`RP-${s['Subdomain Code']}:${LIBRARY_VERSION}`, NAMESPACE),
    prompt_code: `RP-${s['Subdomain Code']}`,
    domain_code: s['Domain Code'],
    subdomain_code: s['Subdomain Code'],
    prompt_text: s['Reflection Prompt'],
    age_band: '13–25',
    sequence: 1,
    version: LIBRARY_VERSION,
    status: 'DRAFT',
    created_at: now,
  }));
  return { actions, prompts };
}

/** Inserts the reference rows that are not present yet. `db` is a Db handle opened with the migrator credential. */
async function seedReference(db) {
  const { actions, prompts } = buildReference();
  const existingA = new Set((await db.collection('development_actions').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
  const existingP = new Set((await db.collection('reflection_prompts').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
  const newA = actions.filter((a) => !existingA.has(a._id));
  const newP = prompts.filter((p) => !existingP.has(p._id));
  if (newA.length) await db.collection('development_actions').insertMany(newA);
  if (newP.length) await db.collection('reflection_prompts').insertMany(newP);
  return { actionsInserted: newA.length, promptsInserted: newP.length };
}

async function main() {
  const i = process.argv.indexOf('--db');
  const dbName = i > -1 ? process.argv[i + 1] : (process.env.MONGODB_DB || 'santulan');
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  if (dbName !== 'santulan' && !/test|qual|scratch/i.test(dbName)) throw new Error(`Refusing database "${dbName}"`);
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const r = await seedReference(client.db(dbName));
    console.log(`reference content in ${dbName}: ${r.actionsInserted} actions and ${r.promptsInserted} prompts inserted`); // eslint-disable-line no-console
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(`seed-reference: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { seedReference, buildReference, LIBRARY_VERSION };
