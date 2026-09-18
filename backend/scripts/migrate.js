/*
 * Minimal raw-SQL migration runner (replaces `prisma migrate deploy`).
 * Applies every *.sql file in backend/migrations/, in filename order, that
 * isn't already recorded in the `_migrations` tracking table. Each file runs
 * inside its own transaction; a failure rolls back that file only and stops
 * the run (leaving already-applied migrations recorded).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "name" TEXT PRIMARY KEY,
      "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM "_migrations"');
  return new Set(rows.map((r) => r.name));
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureTrackingTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying migration: ${file}`); // eslint-disable-line no-console
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO "_migrations" (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (appliedCount === 0) {
      console.log('No pending migrations - database is up to date.'); // eslint-disable-line no-console
    } else {
      console.log(`Applied ${appliedCount} migration(s).`); // eslint-disable-line no-console
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
