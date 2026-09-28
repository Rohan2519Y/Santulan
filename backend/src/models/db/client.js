/*
 * The one MongoClient (database-contract section 1). ONLY the store imports the driver (guarantee G-27).
 * The API refuses to start unless it authenticates as the least-privilege `santulan_runtime` user, the server is a replica
 * set, and the data-model version marker matches the code (G-17).
 */
const { MongoClient } = require('mongodb');
const os = require('os');
const config = require('../../config');
const { HttpError } = require('../../errors');
const { DATA_MODEL_VERSION } = require('../schema');

const RUNTIME_USER = 'santulan_runtime';
let client = null;
let connecting = null;

function unavailable(message) {
  return new HttpError(503, 'STORE_UNAVAILABLE', message);
}

async function getClient() {
  if (client) return client;
  if (!connecting) {
    const uri = config.mongodbUriRuntime;
    if (!uri) throw unavailable('MONGODB_URI_RUNTIME is not configured');
    // runtimeAdapters.os: the driver's default path builds handshake client metadata via `await import('os')`;
    // under Jest's sandboxed module loader that dynamic import of a builtin rejects and the driver silently
    // sends an empty metadata document, which newer MongoDB servers refuse ("Missing required sub-document
    // 'driver'"). Passing the already-required os module bypasses the dynamic import entirely - same module,
    // no behavior change outside tests, and it fixes the in-process app under the integration test suite.
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20, runtimeAdapters: { os } });
    connecting = c.connect()
      .then(() => { client = c; return c; })
      .catch((e) => { connecting = null; throw unavailable(`Cannot connect to the data store: ${e.message}`); });
  }
  return connecting;
}

async function getDb() {
  return (await getClient()).db(config.mongodbDb);
}

/** Start-up checks. Throws STORE_UNAVAILABLE so the process refuses to serve requests. */
async function assertStoreReady() {
  const c = await getClient();
  const admin = c.db('admin');
  const status = await admin.command({ connectionStatus: 1 });
  const users = (status.authInfo && status.authInfo.authenticatedUsers) || [];
  if (users.length !== 1 || users[0].user !== RUNTIME_USER) {
    throw unavailable(`The API must connect as ${RUNTIME_USER} (connected as ${users.map((u) => u.user).join(',') || 'nobody'})`);
  }
  const hello = await admin.command({ hello: 1 });
  if (!hello.setName) throw unavailable('The data store is not a replica set (transactions are required)');
  const marker = await (await getDb()).collection('_data_migrations').findOne({ _id: 'dataModelVersion' });
  if (!marker || marker.value !== DATA_MODEL_VERSION) {
    throw unavailable(`Data-model version mismatch: database has ${marker ? marker.value : 'none'}, code expects ${DATA_MODEL_VERSION}. Run npm run db:migrate.`);
  }
  return { user: RUNTIME_USER, replicaSet: hello.setName, dataModelVersion: marker.value };
}

async function health() {
  try {
    const r = await assertStoreReady();
    return { store: 'ok', ...r };
  } catch (e) {
    return { store: 'unavailable', reason: e.message };
  }
}

async function closeClient() {
  const c = client;
  client = null;
  connecting = null;
  if (c) await c.close();
}

module.exports = { getClient, getDb, assertStoreReady, health, closeClient, RUNTIME_USER };
