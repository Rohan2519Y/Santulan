/*
 * MongoDB test harness (T046). Two clients against the SCRATCH database:
 *   - runtime  : santulan_runtime (what the API uses) - every test under test uses this;
 *   - migrator : santulan_migrator (dbOwner) - fixtures, cleanup, and store-shape checks only.
 * Refuses any database whose name does not contain test, qual or scratch. Fixtures use prefixes STN-FX... / FX-... and are
 * tracked so cleanup runs through the migrator credential (the runtime credential can never remove).
 */
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const DB_NAME = process.env.MONGODB_DB || process.env.MONGODB_TEST_DB || 'santulan_qual';

function assertScratchName(name) {
  if (!/test|qual|scratch/i.test(name)) throw new Error(`Harness refuses database "${name}": name must contain test, qual or scratch.`);
}

let runtimeClient = null;
let adminClient = null;

async function connect(uri, label) {
  if (!uri) throw new Error(`${label} URI is not configured (set MONGODB_URI_${label.toUpperCase()} in backend/.env).`);
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  return c;
}

async function runtime() {
  assertScratchName(DB_NAME);
  if (!runtimeClient) runtimeClient = await connect(process.env.MONGODB_URI_RUNTIME, 'runtime');
  return runtimeClient.db(DB_NAME);
}

async function admin() {
  assertScratchName(DB_NAME);
  if (!adminClient) adminClient = await connect(process.env.MONGODB_URI_ADMIN, 'admin');
  return adminClient.db(DB_NAME);
}

async function rawRuntimeClient() { await runtime(); return runtimeClient; }
async function rawAdminClient() { await admin(); return adminClient; }

async function closeAll() {
  const list = [runtimeClient, adminClient].filter(Boolean);
  runtimeClient = null;
  adminClient = null;
  await Promise.all(list.map((c) => c.close()));
}

/** Tracks inserted ids per collection so `cleanup()` can delete them through the migrator credential. */
function withFixtures(prefix = 'FX') {
  const created = new Map();
  const track = (coll, id) => { if (!created.has(coll)) created.set(coll, []); created.get(coll).push(id); };
  return {
    prefix,
    id: () => uuidv4(),
    /** Insert through the migrator (validators still apply). */
    async insertAdmin(coll, doc) {
      const db = await admin();
      await db.collection(coll).insertOne(doc);
      track(coll, doc._id);
      return doc;
    },
    /** Insert through the runtime credential (what the app can do). */
    async insertRuntime(coll, doc) {
      const db = await runtime();
      await db.collection(coll).insertOne(doc);
      track(coll, doc._id);
      return doc;
    },
    track,
    async cleanup() {
      const db = await admin();
      for (const [coll, ids] of created.entries()) {
        if (ids.length) await db.collection(coll).deleteMany({ _id: { $in: ids } });
      }
      created.clear();
    },
  };
}

/** Asserts a promise rejects with a MongoDB error whose code (or codeName) matches. 121 validator, 11000 duplicate, 13 unauthorized. */
async function expectRefused(promise, code) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error(`Expected the store to refuse with ${code}, but the operation succeeded.`);
  const actual = err.code !== undefined ? err.code : err.errorResponse && err.errorResponse.code;
  const names = { 121: 'DocumentValidationFailure', 11000: 'DuplicateKey', 13: 'Unauthorized' };
  if (code !== undefined && actual !== code && err.codeName !== names[code]) {
    throw new Error(`Expected store error ${code} (${names[code] || '?'}), got ${actual} ${err.codeName || ''}: ${err.message}`);
  }
  return err;
}

/** True when an insert of `doc` is accepted by the collection validator (uses the runtime credential, then removes via the migrator). */
async function accepts(coll, doc) {
  const db = await runtime();
  try {
    await db.collection(coll).insertOne(doc);
  } catch (e) {
    if (e.code === 121) return false;
    throw e;
  }
  const a = await admin();
  await a.collection(coll).deleteOne({ _id: doc._id });
  return true;
}

module.exports = { DB_NAME, assertScratchName, runtime, admin, rawRuntimeClient, rawAdminClient, closeAll, withFixtures, expectRefused, accepts };
