#!/usr/bin/env node
/*
 * Integrity verifier (database-contract section 7). Uses the migrator credential. Exit code 0 only when every check passes.
 *   - the 27 canonical collections + dev collection and the nine views exist with the expected validators
 *   - the 50 named indexes (+ dev index) match by name and definition
 *   - reference content: 216 development actions (all inactive by default), 72 prompts, framework map
 *   - every FROZEN set's recomputed content_hash equals the stored one
 *   - every terminal report's content_hash equals the recomputed fingerprint of its sections
 *   - no two APPROVED wordings share a dimension
 *   - every score / report / growth / pathway row's participant equals its attempt's participant
 *   - exactly one current answer per attempt/question
 *   - audit rows exist for every FROZEN / OPEN question set
 *   node scripts/db-verify.js [--db <name>]
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const schema = require('../src/models/schema');
const framework = require('../seeders/santulan/reference/framework.json');
const canonical = require('../src/services/questionsets/canonical');
const { fingerprint } = require('../src/services/domain/fingerprint');

const norm = (v) => JSON.parse(JSON.stringify(v));

async function checkStructure(db) {
  const failures = [];
  const live = new Map((await db.listCollections({}).toArray()).map((c) => [c.name, c]));
  for (const c of schema.collections) {
    const found = live.get(c.name);
    if (!found) { failures.push({ check: 'collection', detail: `${c.name} is missing` }); continue; }
    const opts = found.options || {};
    if (!opts.validator || JSON.stringify(norm(opts.validator)) !== JSON.stringify(norm(c.validator))) {
      failures.push({ check: 'validator', detail: `${c.name} validator is missing or differs from the data model` });
    } else if (opts.validationLevel !== 'strict' || opts.validationAction !== 'error') {
      failures.push({ check: 'validator', detail: `${c.name} must use validationLevel strict and validationAction error` });
    }
  }
  for (const v of schema.views) {
    const found = live.get(v.name);
    if (!found || found.type !== 'view') failures.push({ check: 'view', detail: `${v.name} is missing or is not a view` });
    else if (found.options.viewOn !== v.source) failures.push({ check: 'view', detail: `${v.name} is not defined on ${v.source}` });
  }
  for (const def of [...schema.indexes, ...schema.devIndexes]) {
    let idx = [];
    try { idx = await db.collection(def.collection).indexes(); } catch (e) { idx = []; }
    const liveIdx = idx.find((i) => i.name === def.name);
    if (!liveIdx) { failures.push({ check: 'index', detail: `${def.name} on ${def.collection} is missing` }); continue; }
    const sameKeys = JSON.stringify(norm(liveIdx.key)) === JSON.stringify(norm(def.keys));
    const samePartial = JSON.stringify(norm(liveIdx.partialFilterExpression || null)) === JSON.stringify(norm(def.partial));
    if (!sameKeys || !!liveIdx.unique !== def.unique || !samePartial) failures.push({ check: 'index', detail: `${def.name} differs from its definition` });
  }
  return failures;
}

async function checkReference(db) {
  const failures = [];
  if (framework.domains.length !== 7 || framework.subdomains.length !== 72) failures.push({ check: 'framework', detail: 'framework.json must hold 7 domains and 72 subdomains' });
  const actions = await db.collection('development_actions').countDocuments({});
  const prompts = await db.collection('reflection_prompts').countDocuments({});
  if (actions !== 216) failures.push({ check: 'reference', detail: `expected 216 development actions, found ${actions}` });
  if (prompts !== 72) failures.push({ check: 'reference', detail: `expected 72 reflection prompts, found ${prompts}` });
  const orphanItems = await db.collection('items').aggregate([
    { $lookup: { from: 'assessment_versions', localField: 'assessment_version_id', foreignField: '_id', as: 'v' } },
    { $match: { v: { $size: 0 } } },
    { $count: 'n' },
  ]).toArray();
  if (orphanItems[0] && orphanItems[0].n) failures.push({ check: 'reference', detail: `${orphanItems[0].n} question(s) belong to no question set` });
  return failures;
}

async function checkFrozenSets(db) {
  const failures = [];
  const sets = await db.collection('assessment_versions').find({ status: 'FROZEN' }).toArray();
  for (const set of sets) {
    const items = await db.collection('items').find({ assessment_version_id: set._id }).toArray();
    const recomputed = canonical.contentHash(items);
    if (recomputed !== set.content_hash) failures.push({ check: 'frozen-hash', detail: `set ${set.version_label} r${set.revision}: content_hash does not match its questions` });
    const audit = await db.collection('audit_logs').countDocuments({ action_type: 'QUESTION_SET_FROZEN', target_id: set._id });
    if (!audit) failures.push({ check: 'audit', detail: `set ${set.version_label} r${set.revision} is FROZEN without an audit row` });
    if (set.participation_state === 'OPEN' && !(await db.collection('audit_logs').countDocuments({ action_type: 'QUESTION_SET_OPENED', target_id: set._id }))) {
      failures.push({ check: 'audit', detail: `set ${set.version_label} r${set.revision} is OPEN without an audit row` });
    }
  }
  return failures;
}

async function checkReports(db) {
  const failures = [];
  const reports = await db.collection('reports').find({ generation_status: { $in: ['REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE'] } }).toArray();
  for (const r of reports) {
    const sections = await db.collection('report_sections').find({ report_id: r._id }).toArray();
    if (fingerprint(sections) !== r.content_hash) failures.push({ check: 'report-hash', detail: `report ${r._id}: content_hash does not match its sections` });
  }
  return failures;
}

async function checkWording(db) {
  const dup = await db.collection('interpretation_rules').aggregate([
    { $match: { status: 'APPROVED' } },
    { $group: { _id: { v: '$assessment_version_id', d: '$domain_code', b: '$developmental_band', e: '$evidence_state', l: '$locale', y: '$layer' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray();
  return dup.map((d) => ({ check: 'wording', detail: `${d.n} APPROVED wordings share ${JSON.stringify(d._id)}` }));
}

async function checkProvenance(db) {
  const failures = [];
  const probes = [
    ['score_results', 'attempt_id', 'participant_id'],
    ['reports', 'attempt_id', 'participant_id'],
    ['growth_plans', 'source_attempt_id', 'participant_id'],
    ['pathway_decisions', 'source_attempt_id', 'participant_id'],
  ];
  for (const [coll, fk, pf] of probes) {
    const bad = await db.collection(coll).aggregate([
      { $lookup: { from: 'assessment_attempts', localField: fk, foreignField: '_id', as: 'a' } },
      { $match: { $expr: { $or: [{ $eq: [{ $size: '$a' }, 0] }, { $ne: [{ $arrayElemAt: [`$a.participant_id`, 0] }, `$${pf}`] }] } } },
      { $count: 'n' },
    ]).toArray();
    if (bad[0] && bad[0].n) failures.push({ check: 'provenance', detail: `${bad[0].n} ${coll} row(s) whose participant differs from the attempt's (or attempt missing)` });
  }
  const scoresVersion = await db.collection('score_results').aggregate([
    { $lookup: { from: 'assessment_attempts', localField: 'attempt_id', foreignField: '_id', as: 'a' } },
    { $match: { $expr: { $ne: [{ $arrayElemAt: ['$a.assessment_version_id', 0] }, '$assessment_version_id'] } } },
    { $count: 'n' },
  ]).toArray();
  if (scoresVersion[0] && scoresVersion[0].n) failures.push({ check: 'provenance', detail: `${scoresVersion[0].n} score row(s) whose question set differs from the attempt's` });
  return failures;
}

async function checkCurrentAnswers(db) {
  const dup = await db.collection('responses').aggregate([
    { $match: { is_current: true } },
    { $group: { _id: { a: '$attempt_id', i: '$item_id' }, n: { $sum: 1 } } },
    { $match: { n: { $ne: 1 } } },
    { $limit: 20 },
  ]).toArray();
  const missing = await db.collection('responses').aggregate([
    { $group: { _id: { a: '$attempt_id', i: '$item_id' }, current: { $sum: { $cond: ['$is_current', 1, 0] } } } },
    { $match: { current: 0 } },
    { $limit: 20 },
  ]).toArray();
  return [...dup, ...missing].map((d) => ({ check: 'current-answer', detail: `attempt ${d._id.a} question ${d._id.i} must have exactly one current answer` }));
}

/** Runs every check against `db`. Returns { ok, failures }. */
async function verify(db) {
  const failures = [
    ...(await checkStructure(db)),
    ...(await checkReference(db)),
    ...(await checkFrozenSets(db)),
    ...(await checkReports(db)),
    ...(await checkWording(db)),
    ...(await checkProvenance(db)),
    ...(await checkCurrentAnswers(db)),
  ];
  return { ok: failures.length === 0, failures };
}

async function main() {
  const i = process.argv.indexOf('--db');
  const dbName = i > -1 ? process.argv[i + 1] : (process.env.MONGODB_DB || 'santulan');
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const { ok, failures } = await verify(client.db(dbName));
    if (ok) console.log(`db-verify ${dbName}: all checks passed`); // eslint-disable-line no-console
    else {
      console.error(`db-verify ${dbName}: ${failures.length} failure(s)`); // eslint-disable-line no-console
      for (const f of failures) console.error(`  [${f.check}] ${f.detail}`); // eslint-disable-line no-console
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(`db-verify: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { verify };
