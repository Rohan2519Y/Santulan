/*
 * DEV-ONLY seeder (spec 005 T077). Creates SYNTHETIC identities so the local system can be used without a managed
 * identity provider: one SUPER_ADMIN and one OPEN participant per assessment track, each with a dev password.
 * No names, contact details or real data. Refuses production. Re-running is safe: existing rows are kept and the
 * passwords are printed only when they are (re)generated (pass --reset to issue new ones).
 *
 *   node seeders/santulan/dev.seeder.js [--reset]
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const PROVIDER = 'santulan-dev';
const PARTICIPANTS = [
  { subject: 'dev-participant-adolescent', age: 15 },
  { subject: 'dev-participant-emerging-adult', age: 21 },
];
const ADMIN_SUBJECT = 'dev-super-admin';

const password = () => `Dev-${crypto.randomBytes(9).toString('base64url')}-7`;

async function ensureCredential(client, subject, reset) {
  const existing = await client.query('SELECT 1 FROM dev_identity.credentials WHERE provider = $1 AND subject_id = $2', [PROVIDER, subject]);
  if (existing.rowCount && !reset) return null;
  const pw = password();
  await client.query(
    `INSERT INTO dev_identity.credentials (provider, subject_id, secret_hash, must_change, status) VALUES ($1, $2, $3, false, 'active')
     ON CONFLICT (provider, subject_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, must_change = false, status = 'active', updated_at = now()`,
    [PROVIDER, subject, await bcrypt.hash(pw, 10)],
  );
  return pw;
}

async function main() {
  if ((process.env.APP_ENV || 'development') === 'production') throw new Error('The dev seeder must never run in production');
  const reset = process.argv.includes('--reset');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const out = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.actor_scope', 'SYSTEM', true)");

    const admin = await client.query(
      `INSERT INTO santulan.admin_users (role, auth_provider, auth_provider_subject_id) VALUES ('SUPER_ADMIN', $1, $2)
       ON CONFLICT (auth_provider, auth_provider_subject_id) DO UPDATE SET updated_at = admin_users.updated_at RETURNING admin_user_id`,
      [PROVIDER, ADMIN_SUBJECT],
    );
    out.push({ who: 'SUPER_ADMIN', login: ADMIN_SUBJECT, password: await ensureCredential(client, ADMIN_SUBJECT, reset), id: admin.rows[0].admin_user_id });

    for (const p of PARTICIPANTS) {
      const found = await client.query('SELECT santulan_id FROM santulan.participants WHERE auth_provider = $1 AND auth_provider_subject_id = $2', [PROVIDER, p.subject]);
      let santulanId = found.rows[0] && found.rows[0].santulan_id;
      if (!santulanId) {
        const { generateSantulanId } = require('../../src/modules/santulan/registration/santulanId');
        santulanId = generateSantulanId();
        await client.query(
          `INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration, administration_language, auth_provider, auth_provider_subject_id)
           VALUES ($1, 'OPEN', $2, 'en', $3, $4)`,
          [santulanId, p.age, PROVIDER, p.subject],
        );
      }
      out.push({ who: `participant (age ${p.age})`, login: santulanId, password: await ensureCredential(client, p.subject, reset) });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log('Dev identities (synthetic, local only):'); // eslint-disable-line no-console
  for (const r of out) console.log(`  ${r.who.padEnd(26)} login: ${r.login}  password: ${r.password || '(unchanged; use --reset to issue a new one)'}`); // eslint-disable-line no-console
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
