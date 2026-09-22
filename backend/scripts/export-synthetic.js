#!/usr/bin/env node
/*
 * Synthetic research-export run (feature 006, T146; SC-010, B08-042/043/047). Seeds synthetic participants, attempts and answers into
 * the SCRATCH database only (migrator credential), runs the real exporter over them, and prints the sheet count, the rows per sheet, the
 * reconciliation against the seeded answers and the peak resident memory.
 *
 *   node scripts/export-synthetic.js --participants 10000 --items 222 [--db santulan_qual] [--keep]
 *
 * Nothing here is real personal data: participants carry the reserved STN-FX prefix and the question set the label prefix fx-synth-.
 * The data is removed again unless --keep is given. The database name must contain test, qual or scratch.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const PARTICIPANTS = Number.parseInt(arg('participants', '1000'), 10);
const ITEMS = Number.parseInt(arg('items', '222'), 10);
const DB_NAME = arg('db', process.env.SANTULAN_TEST_MONGODB_DB || 'santulan_qual');
const KEEP = process.argv.includes('--keep');

if (!/test|qual|scratch/i.test(DB_NAME)) { console.error(`export-synthetic: refusing database "${DB_NAME}" (name must contain test, qual or scratch)`); process.exit(1); } // eslint-disable-line no-console
if (!Number.isInteger(PARTICIPANTS) || PARTICIPANTS < 1 || !Number.isInteger(ITEMS) || ITEMS < 7) { console.error('export-synthetic: --participants must be >= 1 and --items >= 7'); process.exit(1); } // eslint-disable-line no-console

// The exporter reads through the runtime credential; point the store at the scratch database before anything loads the config.
process.env.MONGODB_DB = DB_NAME;
process.env.MONGODB_URI_RUNTIME = process.env.SANTULAN_TEST_MONGODB_URI_RUNTIME || process.env.MONGODB_URI_RUNTIME || '';
process.env.MONGODB_URI_ADMIN = process.env.SANTULAN_TEST_MONGODB_URI_ADMIN || process.env.MONGODB_URI_ADMIN || '';
process.env.EXPORT_DIR = process.env.EXPORT_DIR || path.resolve(__dirname, '..', 'exports', 'synthetic');

const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const F = require('../tests/santulan/helpers/fixtures'); // valid-by-construction document factories (synthetic markers only)
const { sheetCount } = require('../src/modules/santulan/research/partition');

const DOMAINS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const LABEL = `fx-synth-${Date.now()}`;
const BATCH = 10000;
let peakRss = 0;
const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };

async function insertBatched(coll, total, make) {
  for (let start = 0; start < total; start += BATCH) {
    const docs = [];
    for (let i = start; i < Math.min(total, start + BATCH); i += 1) docs.push(make(i));
    await coll.insertMany(docs, { ordered: false }); // eslint-disable-line no-await-in-loop
    sample();
  }
}

async function cleanup(db) {
  const sets = (await db.collection('assessment_versions').find({ version_label: /^fx-synth-/ }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const people = (await db.collection('participants').find({ santulan_id: /^STN-FXSYN/ }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const attempts = (await db.collection('assessment_attempts').find({ participant_id: { $in: people } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  for (let i = 0; i < attempts.length; i += 5000) {
    const chunk = attempts.slice(i, i + 5000);
    await db.collection('responses').deleteMany({ attempt_id: { $in: chunk } }); // eslint-disable-line no-await-in-loop
    await db.collection('score_results').deleteMany({ attempt_id: { $in: chunk } }); // eslint-disable-line no-await-in-loop
  }
  await db.collection('assessment_attempts').deleteMany({ participant_id: { $in: people } });
  await db.collection('participants').deleteMany({ _id: { $in: people } });
  await db.collection('items').deleteMany({ assessment_version_id: { $in: sets } });
  await db.collection('assessment_versions').deleteMany({ _id: { $in: sets } });
  const exportIds = (await db.collection('research_exports').find({ source_assessment_version_id: { $in: sets } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  await db.collection('research_exports').deleteMany({ _id: { $in: exportIds } });
  await db.collection('audit_logs').deleteMany({ target_id: { $in: exportIds } });
}

async function main() {
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  const timer = setInterval(sample, 500);
  try {
    await cleanup(db);
    console.log(`seeding ${PARTICIPANTS} participants x ${ITEMS} answers into ${DB_NAME} ...`); // eslint-disable-line no-console
    const set = F.versionDoc({ version_label: LABEL, status: 'FROZEN', frozen_at: new Date() });
    await db.collection('assessment_versions').insertOne(set);
    // item_code must match the store validator's ^C[1-7]-[0-9]{2}$ (a real domain code, a per-domain sequence number, two
    // digits) - so it is numbered PER DOMAIN, not with a flat synthetic prefix.
    const perDomain = {};
    const items = Array.from({ length: ITEMS }, (_, i) => {
      const domain = DOMAINS[i % 7];
      perDomain[domain] = (perDomain[domain] || 0) + 1;
      return F.item(set._id, {
        item_code: `${domain}-${String(perDomain[domain]).padStart(2, '0')}`, domain_code: domain,
        subdomain_code: domain === 'C7' ? 'C7A.1' : `${domain}.1`, // C7's subdomains are C7A./C7B./C7C., never a plain C7.
        display_order: i + 1,
      });
    });
    await db.collection('items').insertMany(items);

    const people = [];
    await insertBatched(db.collection('participants'), PARTICIPANTS, (i) => {
      const p = F.participant({ santulan_id: `STN-FXSYN${String(i).padStart(14, '0')}`.slice(0, 24).padEnd(24, '0') });
      people.push(p._id);
      return p;
    });
    const attempts = [];
    await insertBatched(db.collection('assessment_attempts'), PARTICIPANTS, (i) => {
      const a = F.attempt(people[i], set._id, { status: 'SCORED', session_count: 1, started_at: new Date(), submitted_at: new Date(), last_activity_at: new Date(), scoring_version: 'synthetic-v1' });
      attempts.push(a._id);
      return a;
    });
    await insertBatched(db.collection('score_results'), PARTICIPANTS * 7, (i) => F.score(attempts[Math.floor(i / 7)], people[Math.floor(i / 7)], set._id, { domain_code: DOMAINS[i % 7], scoring_version: 'synthetic-v1' }));
    const total = PARTICIPANTS * ITEMS;
    await insertBatched(db.collection('responses'), total, (i) => {
      const a = Math.floor(i / ITEMS);
      const item = items[i % ITEMS];
      return F.response(attempts[a], item._id, { response_value: String((i % 5) + 1), idempotency_key: `syn-${uuidv4()}` });
    });
    console.log(`seeded ${total} answers`); // eslint-disable-line no-console

    const exportRow = F.researchExport(uuidv4(), set._id, { anonymisation_version: 'synthetic-v1', filters: { includeAllVersions: false } });
    await db.collection('research_exports').insertOne(exportRow);

    const service = require('../src/modules/santulan/research/exportService'); // eslint-disable-line global-require
    const started = Date.now();
    const result = await service.claimAndGenerate(exportRow._id, { correlationId: 'export-synthetic', onProgress: (p) => { sample(); if (p.rows % 250000 === 0) console.log(`  ${p.sheet}: ${p.rows} rows`); } }); // eslint-disable-line no-console
    if (result.status !== 'READY') throw result.error || new Error('export failed');
    sample();

    const responseRows = result.sheets.filter((s) => s.name.startsWith('ITEM_RESPONSES_')).reduce((n, s) => n + s.rows, 0);
    console.log(`\nexport READY in ${((Date.now() - started) / 1000).toFixed(1)} s, file ${(result.totalBytes / 1048576).toFixed(1)} MB`); // eslint-disable-line no-console
    console.log('sheet                  data rows'); // eslint-disable-line no-console
    for (const s of result.sheets) console.log(`${s.name.padEnd(22)} ${s.rows}`); // eslint-disable-line no-console
    console.log(`\nITEM_RESPONSES sheets: ${result.sheets.filter((s) => s.name.startsWith('ITEM_RESPONSES_')).length} (expected ${sheetCount(total)})`); // eslint-disable-line no-console
    console.log(`reconciliation: ${responseRows} exported answers vs ${total} seeded -> ${responseRows === total ? 'MATCH' : 'MISMATCH'}`); // eslint-disable-line no-console
    console.log(`peak RSS: ${(peakRss / 1048576).toFixed(0)} MB`); // eslint-disable-line no-console
    if (responseRows !== total) process.exitCode = 2;
    if (!KEEP) {
      require('fs').rmSync(service.finalPath(exportRow._id), { force: true }); // eslint-disable-line global-require
      await cleanup(db);
      console.log('synthetic data and file removed (use --keep to retain)'); // eslint-disable-line no-console
    }
  } finally {
    clearInterval(timer);
    await client.close();
    await require('../src/modules/santulan/store/client').closeClient(); // eslint-disable-line global-require
  }
}

main().catch((e) => { console.error(`export-synthetic: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console
