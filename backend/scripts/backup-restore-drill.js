#!/usr/bin/env node
/*
 * Backup and restore drill (feature 006, T158; FR-037, research R-M12). Proves that a backup of the platform database can be restored
 * into a clean scratch database and that the restored copy passes the platform's own checks.
 *
 *   1. mongodump --uri <migrator> --db <source> --archive=<file> --gzip
 *   2. drop and recreate the RESTORE TARGET (a scratch database: its name must contain test, qual or scratch)
 *   3. mongorestore --archive=<file> --gzip --nsFrom "<source>.*" --nsTo "<target>.*"  (views are recreated from the dump)
 *   4. recreate the least-privilege role for the restored database (roles are not part of a database dump)
 *   5. db-verify.js on the restored copy
 *   6. the store-guarantee suite and one end-to-end journey (attempt -> answers -> submit -> quality -> score -> report) against the copy
 *   7. write an evidence file: operator, timestamps, archive SHA-256, per-step PASS / FAIL
 *
 *   node scripts/backup-restore-drill.js [--source santulan_qual] [--target santulan_restore_drill] [--out release/evidence] [--allow-source] [--skip-tests]
 *
 * A non-scratch SOURCE (for example `santulan`) needs --allow-source. A non-scratch TARGET is always refused. The MongoDB tools
 * (mongodump / mongorestore) must be on PATH or in MONGODB_TOOLS_DIR. Nothing prints a credential.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

const BACKEND = path.resolve(__dirname, '..');
const SCRATCH = /test|qual|scratch/i;
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);

const SOURCE = arg('source', process.env.MONGODB_TEST_DB || 'santulan_qual');
const TARGET = arg('target', 'santulan_restore_drill');
const OUT_DIR = path.resolve(BACKEND, arg('out', 'release/evidence'));

function tool(name) {
  const dir = process.env.MONGODB_TOOLS_DIR;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : exe;
}

function run(label, command, args, { env = {}, capture = true } = {}) {
  const started = new Date();
  const r = spawnSync(command, args, { cwd: BACKEND, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = r.status === 0 && !r.error;
  return { label, ok, started: started.toISOString(), finished: new Date().toISOString(), exitCode: r.status, error: r.error ? r.error.message : null, output: capture ? output.slice(-4000) : '' };
}

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const redact = (text) => String(text).replace(/mongodb(\+srv)?:\/\/[^@\s]+@/g, 'mongodb://[redacted]@');

async function main() {
  const uri = process.env.MONGODB_URI_ADMIN;
  if (!uri) throw new Error('MONGODB_URI_ADMIN is not set (migrator credential).');
  if (!SCRATCH.test(TARGET)) throw new Error(`Refusing restore target "${TARGET}": a scratch database name must contain test, qual or scratch.`);
  if (!SCRATCH.test(SOURCE) && !flag('allow-source')) throw new Error(`"${SOURCE}" is not a scratch database; pass --allow-source to back it up.`);
  if (SOURCE === TARGET) throw new Error('The restore target must differ from the source.');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.join(os.tmpdir(), `santulan-drill-${stamp}.archive.gz`);
  const steps = [];
  const record = (s) => { steps.push({ ...s, output: redact(s.output || '') }); console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.label}`); return s.ok; }; // eslint-disable-line no-console
  const startedAt = new Date();

  const client = new MongoClient(uri);
  await client.connect();
  let archiveHash = null;
  try {
    // 1. backup
    if (!record(run('mongodump (source database, gzip archive)', tool('mongodump'), [`--uri=${uri}`, `--db=${SOURCE}`, `--archive=${archive}`, '--gzip']))) throw new Error('backup failed');
    archiveHash = sha256File(archive);

    // 2. clean target
    const t0 = new Date();
    await client.db(TARGET).dropDatabase();
    record({ label: 'clean restore target (dropDatabase)', ok: true, started: t0.toISOString(), finished: new Date().toISOString(), output: '' });

    // 3. restore
    if (!record(run('mongorestore (into the scratch target)', tool('mongorestore'), [`--uri=${uri}`, `--archive=${archive}`, '--gzip', `--nsFrom=${SOURCE}.*`, `--nsTo=${TARGET}.*`]))) throw new Error('restore failed');

    // 4. role for the restored database (roles are not part of a dump)
    const t1 = new Date();
    const { up } = require('../db/migrations/004_runtime_role'); // eslint-disable-line global-require
    await up(client.db(TARGET), { client });
    record({ label: 'recreate the least-privilege role for the restored database', ok: true, started: t1.toISOString(), finished: new Date().toISOString(), output: '' });

    // 5. structural verification
    record(run('db-verify on the restored copy', process.execPath, ['scripts/db-verify.js', '--db', TARGET]));

    // 6. platform checks against the copy
    if (!flag('skip-tests')) {
      const env = { SANTULAN_TEST_MONGODB_DB: TARGET };
      const jest = (label, files) => record(run(label, process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--forceExit', ...files], { env }));
      jest('store-guarantee suite on the restored copy', ['tests/santulan/store']);
      jest('end-to-end journey on the restored copy (attempt, answers, submit, quality, score, report)', ['tests/santulan/integration/scoringMasterE2E.test.js']);
    } else {
      record({ label: 'store suite and journey (skipped by --skip-tests)', ok: false, started: new Date().toISOString(), finished: new Date().toISOString(), output: 'not executed' });
    }
  } catch (err) {
    record({ label: `drill aborted: ${err.message}`, ok: false, started: new Date().toISOString(), finished: new Date().toISOString(), output: '' });
  } finally {
    await client.close();
    fs.rmSync(archive, { force: true });
  }

  const passed = steps.length > 0 && steps.every((s) => s.ok);
  const evidence = {
    drill: 'backup-restore', feature: '006', operator: process.env.USERNAME || process.env.USER || os.userInfo().username, host: os.hostname(),
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), source: SOURCE, restoreTarget: TARGET, archiveSha256: archiveHash,
    result: passed ? 'PASS' : 'FAIL', steps,
  };
  const file = path.join(OUT_DIR, `backup-restore-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nbackup-restore drill: ${evidence.result}. Evidence: ${path.relative(BACKEND, file)}`); // eslint-disable-line no-console
  if (!passed) process.exitCode = 1;
}

main().catch((e) => { console.error(`backup-restore-drill: ${e.message}`); process.exit(1); }); // eslint-disable-line no-console
