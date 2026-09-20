/*
 * Creates (or recreates) a SCRATCH database for the canonical tests, applies every migration through the real runner,
 * the grants, and the dev identity store. Refuses any database name that does not contain test|qual|scratch.
 *
 *   node scripts/santulan-scratch-db.js [databaseName]     default: santulan_qual
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const name = process.argv[2] || 'santulan_qual';
if (!/^[a-z0-9_]+$/.test(name) || !/(test|qual|scratch)/.test(name)) {
  console.error(`Refusing: "${name}" must be lowercase letters/digits/underscore and contain test, qual or scratch.`); // eslint-disable-line no-console
  process.exit(1);
}

const admin = new URL(process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/postgres');
const target = new URL(admin.href);
target.pathname = `/${name}`;
target.search = '';
admin.pathname = '/postgres';
admin.search = '';

async function main() {
  const client = new Client({ connectionString: admin.href });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name} ENCODING 'UTF8'`);
  await client.end();

  const env = { ...process.env, DATABASE_URL: target.href };
  for (const script of ['migrate.js', 'santulan-grant-roles.js', 'dev-identity-setup.js']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, script)], { env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  console.log(`Scratch database ${name} is ready: ${target.href.replace(/:[^:@/]+@/, ':***@')}`); // eslint-disable-line no-console
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exit(1);
});
