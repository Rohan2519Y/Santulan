/*
 * DEV-ONLY credential store (spec 005 decision D-17, approved 2026-09-20).
 *
 * The 28 canonical tables hold no password, OTP, name or email (BUILD 03, Constitution VIII). For local development the
 * dev identity adapter (src/modules/santulan/identity/devProvider.js) keeps bcrypt-hashed passwords here, in a separate
 * schema `dev_identity` that is NOT part of the canonical schema. Production uses the managed identity provider and
 * never runs this script.
 */
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  if ((process.env.APP_ENV || 'development') === 'production') {
    throw new Error('dev-identity-setup must never run in production (use the managed identity provider)');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS dev_identity');
    await client.query(`
      CREATE TABLE IF NOT EXISTS dev_identity.credentials (
        provider    text        NOT NULL DEFAULT 'santulan-dev',
        subject_id  text        NOT NULL,
        secret_hash text        NOT NULL,
        must_change boolean     NOT NULL DEFAULT false,
        status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, subject_id)
      )`);
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime'");
    if (role.rowCount) {
      await client.query('GRANT USAGE ON SCHEMA dev_identity TO app_runtime');
      await client.query('GRANT SELECT, INSERT, UPDATE ON dev_identity.credentials TO app_runtime');
    }
    console.log('Dev identity store ready (schema dev_identity, outside the canonical 28 tables).'); // eslint-disable-line no-console
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
