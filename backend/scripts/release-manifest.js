#!/usr/bin/env node
/*
 * Release manifest (feature 006, T159): a fingerprint of everything that defines what a release contains, so a go / no-go decision refers
 * to exact content. It hashes the data-model migrations, the schema definitions, the reference content, the example configuration files, the
 * content hash and revision of every question set, and the application commit. The result is written UNSIGNED to release/manifest.json:
 * the signature field stays empty until the go / no-go decision is made by the owners.
 *
 *   node scripts/release-manifest.js [--db <name>] [--no-db]
 *
 * With the migrator credential it also lists the question sets of the database (label, revision, age group, status, content hash). With
 * --no-db (or no credential) the question-set section is empty and says so.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const BACKEND = path.resolve(__dirname, '..');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** All files under `dir` (recursive) whose relative path matches `keep`, sorted so the manifest is stable. */
function walk(dir, keep = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out.sort();
}

const rel = (file) => path.relative(BACKEND, file).split(path.sep).join('/');
const entry = (file) => ({ path: rel(file), sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size });

function commit() {
  try {
    const run = (...args) => execFileSync('git', args, { cwd: BACKEND, encoding: 'utf8' }).trim();
    return { commit: run('rev-parse', 'HEAD'), branch: run('rev-parse', '--abbrev-ref', 'HEAD'), workingTreeClean: run('status', '--porcelain') === '' };
  } catch (err) {
    return { commit: null, branch: null, workingTreeClean: null, note: 'git is not available' };
  }
}

async function questionSets(dbName) {
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) return { database: null, sets: [], note: 'MONGODB_URI_ADMIN is not set; question sets not listed' };
  const { MongoClient } = require('mongodb'); // eslint-disable-line global-require
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const sets = await client.db(dbName).collection('assessment_versions').find({}, { projection: { version_label: 1, revision: 1, configuration: 1, status: 1, participation_state: 1, content_hash: 1, source_file_hash: 1, frozen_at: 1 } })
      .sort({ version_label: 1, revision: 1 }).toArray();
    return {
      database: dbName,
      sets: sets.map((s) => ({ id: s._id, label: s.version_label, revision: s.revision, ageGroup: s.configuration, status: s.status, participationState: s.participation_state, contentHash: s.content_hash, sourceFileHash: s.source_file_hash, frozenAt: s.frozen_at })),
    };
  } catch (err) {
    return { database: dbName, sets: [], note: `question sets not listed: ${err.message}` };
  } finally {
    await client.close().catch(() => {});
  }
}

async function build({ dbName, useDb = true } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const migrations = walk(path.join(BACKEND, 'db', 'migrations'), (f) => f.endsWith('.js')).map(entry);
  const schema = walk(path.join(BACKEND, 'db', 'schema')).map(entry);
  const reference = walk(path.join(BACKEND, 'seeders', 'santulan', 'reference')).map(entry);
  const config = walk(path.join(BACKEND, 'config'), (f) => /\.example\.json$/.test(f) || f.endsWith('messages.json')).map(entry);
  const sets = useDb ? await questionSets(dbName) : { database: null, sets: [], note: 'question sets not listed (--no-db)' };
  const body = {
    manifestVersion: 1, feature: '006-mongodb-question-upload', generatedAt: new Date().toISOString(),
    application: { name: pkg.name, version: pkg.version, ...commit() },
    dataModel: { migrations, schema },
    referenceContent: reference,
    configuration: config,
    questionSets: sets,
  };
  // one fingerprint over the deterministic parts (everything except the timestamp), so two manifests of the same content agree
  const { generatedAt, ...stable } = body; // eslint-disable-line no-unused-vars
  return { ...body, manifestSha256: sha256(Buffer.from(JSON.stringify(stable))), signature: '' };
}

async function main() {
  const i = process.argv.indexOf('--db');
  const dbName = i > -1 ? process.argv[i + 1] : (process.env.MONGODB_DB || 'santulan');
  const manifest = await build({ dbName, useDb: !process.argv.includes('--no-db') });
  const outDir = path.join(BACKEND, 'release');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'manifest.json');
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release manifest written to ${rel(file)} (unsigned): ${manifest.dataModel.migrations.length} migrations, ${manifest.dataModel.schema.length} schema files, ${manifest.questionSets.sets.length} question sets, sha256 ${manifest.manifestSha256}`); // eslint-disable-line no-console
}

if (require.main === module) main().catch((e) => { console.error(`release-manifest: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { build, walk, sha256 };
