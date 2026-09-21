#!/usr/bin/env node
/**
 * Dedicated local MongoDB instance for Santulan (feature 006, research R-M01, database-contract section 1).
 *
 *   node scripts/mongo-local.js init [--write-env]   write config + keyFile, start, rs.initiate, create users
 *   node scripts/mongo-local.js start                start the dedicated instance
 *   node scripts/mongo-local.js stop                 stop it (process id from backend/.mongo/mongod.pid)
 *   node scripts/mongo-local.js status               port, replica set name, primary state, authorization
 *
 * The existing "MongoDB" Windows service on port 27017 hosts other databases. This script NEVER touches it:
 * it refuses port 27017 and only ever starts/stops the process whose pid file lives in backend/.mongo/.
 * No Docker: uses the locally installed mongod.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { MongoClient } = require('mongodb');

const ROOT = path.resolve(__dirname, '..', '.mongo');
const DATA = path.join(ROOT, 'data');
const CFG = path.join(ROOT, 'mongod.cfg');
const KEYFILE = path.join(ROOT, 'keyfile');
const PIDFILE = path.join(ROOT, 'mongod.pid');
const LOGFILE = path.join(ROOT, 'mongod.log');
const PORT = Number(process.env.SANTULAN_MONGO_PORT || 27018);
const REPL_SET = 'rs0';
const HOST = '127.0.0.1';
const DBS = ['santulan', 'santulan_qual'];

function mongodExe() {
  const candidates = [
    process.env.MONGOD_PATH,
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe',
    'mongod',
  ].filter(Boolean);
  for (const c of candidates) if (c === 'mongod' || fs.existsSync(c)) return c;
  throw new Error('mongod not found. Install MongoDB 8.0+ locally or set MONGOD_PATH.');
}

function assertSafePort() {
  if (PORT === 27017) {
    throw new Error('Refusing port 27017: that is the shared MongoDB service. Santulan uses its own instance (27018).');
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port, timeout: 800 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeConfig() {
  fs.mkdirSync(DATA, { recursive: true });
  const fwd = (p) => p.replace(/\\/g, '/');
  const cfg = [
    'net:',
    `  port: ${PORT}`,
    `  bindIp: ${HOST}`,
    'storage:',
    `  dbPath: "${fwd(DATA)}"`,
    'replication:',
    `  replSetName: ${REPL_SET}`,
    'security:',
    '  authorization: enabled',
    `  keyFile: "${fwd(KEYFILE)}"`,
    'systemLog:',
    '  destination: file',
    `  path: "${fwd(LOGFILE)}"`,
    '  logAppend: true',
    'processManagement:',
    `  pidFilePath: "${fwd(PIDFILE)}"`,
    '',
  ].join('\n');
  fs.writeFileSync(CFG, cfg);
  if (!fs.existsSync(KEYFILE)) fs.writeFileSync(KEYFILE, crypto.randomBytes(600).toString('base64'));
}

async function startProcess() {
  assertSafePort();
  if (await portOpen(PORT)) return false; // already running
  const child = spawn(mongodExe(), ['--config', CFG], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 60; i += 1) {
    if (await portOpen(PORT)) return true;
    await sleep(500);
  }
  throw new Error(`mongod did not open port ${PORT}; see ${LOGFILE}`);
}

const direct = (extra = {}) => ({ directConnection: true, serverSelectionTimeoutMS: 8000, ...extra });
const uriBase = (user, pw, db, tail = '') => `mongodb://${user}:${pw}@${HOST}:${PORT}/${db}${tail}`;
const secret = () => crypto.randomBytes(18).toString('hex');

async function init(args) {
  assertSafePort();
  if (fs.existsSync(path.join(DATA, 'WiredTiger'))) {
    throw new Error(`${DATA} already holds a database. Use "start". (To rebuild, stop the instance and delete backend/.mongo/.)`);
  }
  writeConfig();
  // First start: replica-set + keyFile + authorization; the localhost exception permits rs.initiate and the first user.
  await startProcess();
  const boot = new MongoClient(`mongodb://${HOST}:${PORT}/`, direct());
  await boot.connect();
  await boot.db('admin').command({
    replSetInitiate: { _id: REPL_SET, members: [{ _id: 0, host: `${HOST}:${PORT}` }] },
  });
  for (let i = 0; i < 60; i += 1) {
    const h = await boot.db('admin').command({ hello: 1 });
    if (h.isWritablePrimary) break;
    await sleep(500);
  }
  const rootPw = secret();
  const migPw = secret();
  const rtPw = secret();
  await boot.db('admin').command({
    createUser: 'root_admin', pwd: rootPw, roles: [{ role: 'root', db: 'admin' }],
  });
  await boot.close();

  const root = new MongoClient(uriBase('root_admin', rootPw, 'admin', '?authSource=admin'), direct());
  await root.connect();
  await root.db('santulan').command({
    createUser: 'santulan_migrator', pwd: migPw,
    roles: DBS.map((db) => ({ role: 'dbOwner', db })),
  });
  // Runtime user: no roles until migration 004 creates the least-privilege role and grants it.
  await root.db('santulan').command({ createUser: 'santulan_runtime', pwd: rtPw, roles: [] });
  await root.close();

  const tail = `?replicaSet=${REPL_SET}&authSource=santulan`;
  const runtimeUri = uriBase('santulan_runtime', rtPw, 'santulan', tail);
  const adminUri = uriBase('santulan_migrator', migPw, 'santulan', tail);
  console.log('Dedicated MongoDB instance initialised (shown once - store them, they are not written anywhere else):');
  console.log(`  root_admin        (admin, root) password: ${rootPw}`);
  console.log(`  MONGODB_URI_RUNTIME=${runtimeUri}`);
  console.log(`  MONGODB_URI_ADMIN=${adminUri}`);
  if (args.includes('--write-env')) {
    const envPath = path.resolve(__dirname, '..', '.env');
    const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (/^MONGODB_URI_RUNTIME=/m.test(current)) {
      console.log('backend/.env already has MONGODB_URI_RUNTIME; left unchanged.');
    } else {
      const add = `${current.endsWith('\n') || !current ? '' : '\n'}\n# MongoDB dedicated instance (scripts/mongo-local.js init)\n`
        + `MONGODB_URI_RUNTIME="${runtimeUri}"\nMONGODB_URI_ADMIN="${adminUri}"\nMONGODB_DB=santulan\nMONGODB_TEST_DB=santulan_qual\n`;
      fs.writeFileSync(envPath, current + add);
      console.log('Wrote MONGODB_* to the git-ignored backend/.env');
    }
  }
}

async function start() {
  assertSafePort();
  if (!fs.existsSync(CFG)) throw new Error('Not initialised. Run: npm run db:local:init');
  const started = await startProcess();
  console.log(started ? `Started dedicated MongoDB on ${HOST}:${PORT}` : `Already running on ${HOST}:${PORT}`);
}

async function stop() {
  assertSafePort();
  if (!fs.existsSync(PIDFILE)) {
    console.log('No pid file: the dedicated instance is not running (or was not started by this script).');
    return;
  }
  const pid = Number(fs.readFileSync(PIDFILE, 'utf8').trim());
  if (!pid) throw new Error('pid file is unreadable');
  try { process.kill(pid); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  for (let i = 0; i < 40; i += 1) {
    if (!(await portOpen(PORT))) break;
    await sleep(500);
  }
  try { fs.unlinkSync(PIDFILE); } catch (_) { /* already gone */ }
  console.log(await portOpen(PORT) ? 'Stop requested; port still open.' : `Stopped dedicated MongoDB (port ${PORT}).`);
}

async function status() {
  assertSafePort();
  const open = await portOpen(PORT);
  console.log(`port ${PORT}: ${open ? 'listening' : 'not listening'}`);
  if (!open) { process.exitCode = 1; return; }
  const c = new MongoClient(`mongodb://${HOST}:${PORT}/`, direct());
  await c.connect();
  try {
    const h = await c.db('admin').command({ hello: 1 });
    console.log(`setName: ${h.setName || '(none - standalone)'}`);
    console.log(`state: ${h.isWritablePrimary ? 'PRIMARY' : h.secondary ? 'SECONDARY' : 'OTHER'}`);
    let authorization = 'unknown';
    try {
      await c.db('admin').command({ listCollections: 1, nameOnly: true });
      authorization = 'DISABLED (an unauthenticated command succeeded)';
      process.exitCode = 1;
    } catch (e) {
      authorization = e.code === 13 ? 'enabled' : `unknown (${e.codeName || e.message})`;
    }
    console.log(`authorization: ${authorization}`);
  } finally {
    await c.close();
  }
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const actions = { init, start, stop, status };
  if (!actions[cmd]) {
    console.error('Usage: node scripts/mongo-local.js init [--write-env] | start | stop | status');
    process.exit(2);
  }
  actions[cmd](args).catch((e) => { console.error(`mongo-local: ${e.message}`); process.exit(1); });
}

module.exports = { PORT, REPL_SET, DBS };
