#!/usr/bin/env node
/*
 * Drops and recreates the SCRATCH database (name must contain test, qual or scratch; default MONGODB_TEST_DB=santulan_qual),
 * then applies the data-model migrations, the reference content and the dev seed. Uses the migrator credential.
 * Replaces scripts/santulan-scratch-db.js (PostgreSQL). Prints the database name, never a credential.
 *   node scripts/db-scratch.js [--db <name>] [--no-seed]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const { migrate } = require('./db-migrate');

function assertScratch(name) {
  if (!/test|qual|scratch/i.test(name)) throw new Error(`Refusing to drop "${name}": a scratch database name must contain test, qual or scratch.`);
}

async function rebuild(client, dbName, { seed = true } = {}) {
  assertScratch(dbName);
  await client.db(dbName).dropDatabase();
  const result = await migrate(client, dbName);
  if (seed) {
    const { seedReference } = require('./seed-reference'); // eslint-disable-line global-require
    await seedReference(client.db(dbName));
  }
  return result;
}

async function main() {
  const i = process.argv.indexOf('--db');
  const dbName = i > -1 ? process.argv[i + 1] : (process.env.MONGODB_TEST_DB || 'santulan_qual');
  const seed = !process.argv.includes('--no-seed');
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const { applied } = await rebuild(client, dbName, { seed });
    console.log(`scratch database "${dbName}" rebuilt: migrations [${applied.join(', ')}]${seed ? ', reference content loaded' : ''}`); // eslint-disable-line no-console
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(`db-scratch: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console

module.exports = { rebuild, assertScratch };
