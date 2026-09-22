/*
 * Clean set-up on the document store (T164; SC-013, FR-023/024 replaced by reference content): from a dropped scratch database
 * `db:migrate`, `db:seed:reference`, `db:verify` and the dev seeder all succeed, a second full run changes nothing, the platform
 * boots with only `MONGODB_*` database variables set, and exactly 0 question sets exist after set-up.
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('../helpers/mongoHarness');

// each test here spawns a whole extra Node process (a real migration/seed/verify run); alongside the rest of the full
// suite competing for CPU that can pass 20s, well within what a human operator would still call "fast" for a fresh set-up.
jest.setTimeout(60000);

const BACKEND = path.resolve(__dirname, '..', '..', '..');
const NODE = process.execPath;
const DB = 'santulan_scratch_setup';
const SCRIPTS = {
  migrate: path.join(BACKEND, 'scripts', 'db-migrate.js'),
  seedReference: path.join(BACKEND, 'scripts', 'seed-reference.js'),
  dbVerify: path.join(BACKEND, 'scripts', 'db-verify.js'),
  devSeed: path.join(BACKEND, 'seeders', 'santulan', 'dev.seeder.js'),
};
const serverPath = path.join(BACKEND, 'src', 'server.js');

function run(script, args = [], extra = {}) {
  const r = spawnSync(NODE, [script, ...args], { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, ...extra } });
  const msg = `${path.basename(script)} failed:\n${r.stderr || r.stdout}`;
  expect(r.status).toBe(0, msg);
  return r.stdout;
}

async function db() {
  await H.admin();
  const client = await H.rawAdminClient(); // rawAdminClient() is itself async: it must be awaited before .db() can be called
  return client.db(DB);
}

async function collectionCounts(dbHandle) {
  const names = await dbHandle.listCollections({}, { nameOnly: true }).toArray();
  const out = {};
  for (const c of names) out[c.name] = await dbHandle.collection(c.name).countDocuments();
  return out;
}

describe('scratch set-up (SC-013)', () => {
  let client;

  beforeAll(async () => {
    client = await H.rawAdminClient();
    await client.db(DB).dropDatabase();
  });

  afterAll(async () => {
    await client.db(DB).dropDatabase();
    await H.closeAll();
  });

  test('db:migrate succeeds on the empty scratch database and the ledger records the data-model version', async () => {
    const out = run(SCRIPTS.migrate, ['--db', DB], { MONGODB_DB: DB });
    expect(out).toMatch(/db \S+: applied \[/);
    const d = await db();
    const ledger = await d.collection('_data_migrations').find({}, { projection: { _id: 1 } }).toArray();
    expect(ledger.length).toBeGreaterThan(0);
    const versioned = (await d.collection('_data_migrations').findOne({ _id: 'dataModelVersion' }));
    expect(versioned && versioned.value).toBeTruthy();
  });

  test('db:seed:reference loads the 216 actions and 72 prompts and creates no question set', async () => {
    const out = run(SCRIPTS.seedReference, ['--db', DB], { MONGODB_DB: DB });
    const d = await db();
    expect((await d.collection('development_actions').countDocuments())).toBe(216);
    expect((await d.collection('reflection_prompts').countDocuments())).toBe(72);
    expect((await d.collection('assessment_versions').countDocuments())).toBe(0);
  });

  test('the dev seeder creates one admin and one participant per track, all synthetic', async () => {
    const out = run(SCRIPTS.devSeed, [], { MONGODB_DB: DB });
    expect(out).toMatch(/SUPER_ADMIN/);
    const d = await db();
    expect((await d.collection('admin_users').countDocuments())).toBe(1);
    expect((await d.collection('admin_users').findOne()).auth_provider).toBe('santulan-dev');
    expect((await d.collection('participants').countDocuments())).toBe(2);
    for (const p of await d.collection('participants').find({}, { projection: { santulan_id: 1, participation_route: 1 } }).toArray()) {
      expect(p.santulan_id).toMatch(/^STN-/);
      expect(p.participation_route).toBe('OPEN');
    }
    expect((await d.collection('dev_identity_credentials').countDocuments())).toBe(3);
    expect((await d.collection('assessment_versions').countDocuments())).toBe(0);
  });

  test('db:verify passes on the freshly set-up database', () => {
    const out = run(SCRIPTS.dbVerify, ['--db', DB], { MONGODB_DB: DB });
    expect(out).toMatch(/all checks passed/);
  });

  test('a second full run changes nothing (migrate, seed reference, dev seed, verify all idempotent)', async () => {
    const d = await db();
    const before = await collectionCounts(d);
    run(SCRIPTS.migrate, ['--db', DB], { MONGODB_DB: DB });
    run(SCRIPTS.seedReference, ['--db', DB], { MONGODB_DB: DB });
    run(SCRIPTS.devSeed, [], { MONGODB_DB: DB });
    const after = await collectionCounts(d);
    expect(after).toEqual(before);
    const out = run(SCRIPTS.dbVerify, ['--db', DB], { MONGODB_DB: DB });
    expect(out).toMatch(/all checks passed/);
  });

  test('the platform boots with only MONGODB_* database variables set', async () => {
    const port = String(20000 + Math.floor(Math.random() * 20000));
    const minimal = {
      PATH: process.env.PATH,
      MONGODB_URI_RUNTIME: process.env.MONGODB_URI_RUNTIME,
      MONGODB_DB: DB,
      APP_PORT: port,
    };
    expect(process.env.DATABASE_URL || process.env.RUNTIME_DATABASE_URL || process.env.PLATFORM_DATABASE_URL).toBeUndefined();
    const child = spawn(NODE, [serverPath], { cwd: BACKEND, env: minimal, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    child.stdout.on('data', (c) => output.push(String(c)));
    child.stderr.on('data', (c) => output.push(String(c)));
    const alive = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(true), 1800);
      child.once('exit', (code) => { clearTimeout(t); resolve(false); });
    });
    if (alive) child.kill();
    const text = output.join('');
    expect(alive).toBe(true, `server exited during boot\n${text}`);
    expect(text).not.toMatch(/database_url/i);
  });
});