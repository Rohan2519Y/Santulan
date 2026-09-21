#!/usr/bin/env node
/*
 * Governed loading of approved report wording (feature 006, T130; scoring-and-report contract section 8). The engines never write prose:
 * a report layer exists only for wording that was loaded here and approved. Uses the migrator credential (MONGODB_URI_ADMIN).
 *
 *   node scripts/wording-load.js <file.json> [--approve] [--db <name>]
 *
 *   file: { "questionSet": "<label>", "revision": <n>, "rules": [ { "domain": "C1", "band": null | "D1".."D4", "evidenceState": "S2".."S5",
 *                                                                    "locale": "en", "layer": "MEANING", "version": "v1", "text": "..." } ] }
 *
 * Rules are inserted as DRAFT (idempotent: an identical rule is left alone). `--approve` approves the rules of the file, one audited
 * transaction per rule. A second APPROVED rule for the same dimension (question set, domain, band, evidence state, locale, layer) is
 * refused by the unique index `uq_one_approved_rule_per_dimension`. Wording below S2 is refused: S0 / S1 / SH domains never receive
 * interpretation, so there is nothing to load for them. This script never edits the text of an approved rule.
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const { MongoClient } = require('mongodb');

const NAMESPACE = '3c9a5f1e-7b24-4d86-a0c1-5e8d2f6b9a47'; // deterministic ids: a re-run inserts nothing new
const DOMAINS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const BANDS = ['D1', 'D2', 'D3', 'D4'];
const STATES = ['S2', 'S3', 'S4', 'S5'];
const LAYERS = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'PRIORITY', 'ACTION'];

class WordingFileError extends Error {}

const nonblank = (v) => typeof v === 'string' && v.trim() !== '';

/** Validates the file content; returns the normalised rules or throws WordingFileError listing every problem. */
function validateWordingFile(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new WordingFileError('the wording file must be a JSON object');
  if (!nonblank(spec.questionSet)) problems.push('questionSet (the question set label) is required');
  if (!Number.isInteger(spec.revision) || spec.revision < 1) problems.push('revision must be a positive integer');
  if (!Array.isArray(spec.rules) || !spec.rules.length) problems.push('rules must be a non-empty array');
  const rules = [];
  const seen = new Set();
  (Array.isArray(spec.rules) ? spec.rules : []).forEach((r, i) => {
    const at = `rules[${i}]`;
    const bad = (m) => problems.push(`${at}: ${m}`);
    if (!r || typeof r !== 'object') { bad('must be an object'); return; }
    const band = r.band === undefined ? null : r.band;
    if (!DOMAINS.includes(r.domain)) bad(`domain must be one of ${DOMAINS.join(', ')}`);
    if (band !== null && !BANDS.includes(band)) bad(`band must be null or one of ${BANDS.join(', ')}`);
    if (!STATES.includes(r.evidenceState)) bad(`evidenceState must be one of ${STATES.join(', ')} (no interpretation exists below S2)`);
    if (!nonblank(r.locale)) bad('locale is required');
    if (!LAYERS.includes(r.layer)) bad(`layer must be one of ${LAYERS.join(', ')}`);
    if (!nonblank(r.version)) bad('version is required');
    if (!nonblank(r.text)) bad('text is required');
    const key = [r.domain, band, r.evidenceState, r.locale, r.layer, r.version].join('|');
    if (seen.has(key)) bad('duplicates an earlier rule of this file');
    seen.add(key);
    rules.push({ domain: r.domain, band, evidenceState: r.evidenceState, locale: r.locale, layer: r.layer, version: r.version, text: typeof r.text === 'string' ? r.text.trim() : r.text });
  });
  if (problems.length) throw new WordingFileError(problems.join('\n'));
  return { questionSet: spec.questionSet.trim(), revision: spec.revision, rules };
}

const ruleCode = (r) => `${r.layer}.${r.domain}.${r.evidenceState}.${r.band || 'ANY'}`;
const ruleId = (setId, r) => uuidv5(`${setId}|${ruleCode(r)}|${r.version}|${r.locale}`, NAMESPACE);

/**
 * Loads (and optionally approves) the rules of a validated file. `client` is a MongoClient with the migrator credential.
 * @returns {{ setId: string, inserted: number, existing: number, approved: number, alreadyApproved: number }}
 */
async function loadWording(client, dbName, spec, { approve = false } = {}) {
  const db = client.db(dbName);
  const { questionSet, revision, rules } = validateWordingFile(spec);
  const set = await db.collection('assessment_versions').findOne({ version_label: questionSet, revision });
  if (!set) throw new WordingFileError(`question set "${questionSet}" revision ${revision} was not found in ${dbName}`);

  const now = new Date();
  const docs = rules.map((r) => ({
    _id: ruleId(set._id, r), assessment_version_id: set._id, domain_code: r.domain, developmental_band: r.band, evidence_state: r.evidenceState, locale: r.locale,
    layer: r.layer, rule_code: ruleCode(r), approved_text_template: r.text, version: r.version, status: 'DRAFT', created_at: now,
  }));
  const present = new Map((await db.collection('interpretation_rules').find({ _id: { $in: docs.map((d) => d._id) } }).toArray()).map((d) => [d._id, d]));
  for (const d of docs) { // never silently differ from what is stored: a changed text under the same version needs a new version
    const have = present.get(d._id);
    if (have && have.approved_text_template !== d.approved_text_template) throw new WordingFileError(`${d.rule_code} version ${d.version} already exists with different text; load the change under a new version`);
  }
  const fresh = docs.filter((d) => !present.has(d._id));
  if (fresh.length) await db.collection('interpretation_rules').insertMany(fresh);

  let approved = 0;
  let alreadyApproved = 0;
  if (approve) {
    for (const d of docs) {
      const have = present.get(d._id);
      if (have && have.status === 'APPROVED') { alreadyApproved += 1; continue; }
      if (have && have.status === 'RETIRED') throw new WordingFileError(`${d.rule_code} version ${d.version} was retired; load it under a new version`);
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          let r;
          try { r = await db.collection('interpretation_rules').updateOne({ _id: d._id, status: 'DRAFT' }, { $set: { status: 'APPROVED' } }, { session }); } catch (err) {
            if (err && err.code === 11000) throw new WordingFileError(`a second approved wording for ${d.rule_code} (${d.locale}) is refused: retire the current approved rule first`);
            throw err;
          }
          if (r.modifiedCount !== 1) throw new WordingFileError(`${d.rule_code} could not be approved (it changed while loading)`);
          await db.collection('audit_logs').insertOne({
            _id: uuidv4(), actor_type: 'SYSTEM', actor_id: null, action_type: 'WORDING_APPROVED', target_entity: 'interpretation_rules', target_id: d._id,
            previous_state: { status: 'DRAFT' }, new_state: { status: 'APPROVED', rule_code: d.rule_code, version: d.version }, reason: 'governed wording load (--approve)', occurred_at: new Date(), correlation_id: null,
          }, { session });
        });
      } finally { await session.endSession(); }
      approved += 1;
    }
  }
  return { setId: set._id, inserted: fresh.length, existing: docs.length - fresh.length, approved, alreadyApproved };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--db') + 1]);
  const i = args.indexOf('--db');
  const dbName = i > -1 ? args[i + 1] : (process.env.MONGODB_DB || 'santulan');
  if (!file) throw new Error('usage: node scripts/wording-load.js <file.json> [--approve] [--db <name>]');
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  if (dbName !== 'santulan' && !/test|qual|scratch/i.test(dbName)) throw new Error(`Refusing database "${dbName}"`);
  const spec = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const r = await loadWording(client, dbName, spec, { approve: args.includes('--approve') });
    console.log(`wording for ${spec.questionSet} r${spec.revision} in ${dbName}: ${r.inserted} inserted, ${r.existing} already present, ${r.approved} approved, ${r.alreadyApproved} already approved`); // eslint-disable-line no-console
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(`wording-load: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { loadWording, validateWordingFile, ruleCode, ruleId, WordingFileError, STATES, LAYERS, DOMAINS, BANDS };
