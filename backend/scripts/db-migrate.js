#!/usr/bin/env node
/*
 * Applies backend/db/migrations/*.js in filename order with the MIGRATOR credential (MONGODB_URI_ADMIN).
 * Forward-only: an applied file's SHA-256 is recorded in `_data_migrations`; if it changes, the run refuses (constitution III).
 * Refuses any database whose name is not `santulan` and does not contain test, qual or scratch.
 *   node scripts/db-migrate.js [--db <name>]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { DATA_MODEL_VERSION } = require('../db/schema');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations');

function assertAllowedDb(name) {
  if (name === 'santulan' || /test|qual|scratch/i.test(name)) return;
  throw new Error(`Refusing database "${name}": only "santulan" or a name containing test, qual or scratch.`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.js$/.test(f)).sort();
}

/** Applies every pending migration to `dbName` through an existing migrator client. Returns { applied, skipped }. */
async function migrate(client, dbName) {
  assertAllowedDb(dbName);
  const db = client.db(dbName);
  const ledger = db.collection('_data_migrations');
  const applied = [];
  const skipped = [];
  for (const file of listMigrations()) {
    const full = path.join(MIGRATIONS_DIR, file);
    const hash = sha256(fs.readFileSync(full));
    const mig = require(full); // eslint-disable-line global-require, import/no-dynamic-require
    const prior = await ledger.findOne({ _id: mig.name });
    if (prior) {
      if (prior.sha256 !== hash) throw new Error(`Applied migration ${mig.name} was edited (hash changed). Add a new numbered migration instead.`);
      skipped.push(mig.name);
      continue;
    }
    await mig.up(db, { client, dbName });
    await ledger.insertOne({ _id: mig.name, sha256: hash, appliedAt: new Date() });
    applied.push(mig.name);
  }
  await ledger.updateOne({ _id: 'dataModelVersion' }, { $set: { value: DATA_MODEL_VERSION, updatedAt: new Date() } }, { upsert: true });
  return { applied, skipped };
}

async function main() {
  const i = process.argv.indexOf('--db');
  const dbName = i > -1 ? process.argv[i + 1] : (process.env.MONGODB_DB || 'santulan');
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const { applied, skipped } = await migrate(client, dbName);
    console.log(`db ${dbName}: applied [${applied.join(', ') || 'none'}], already applied [${skipped.length}]`); // eslint-disable-line no-console
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(`db-migrate: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { migrate, assertAllowedDb, listMigrations, sha256, MIGRATIONS_DIR };
