/*
 * Seeds one demo school, one admin and one student into the platform schema
 * (docs/SQL-Database-Schema.md tables: schools, accounts, student_profiles, consent_records).
 * Idempotent: re-running changes nothing that already exists.
 *
 * Runs as the migration/owner connection (DATABASE_URL), not app_runtime, so it is not
 * subject to row-level security.
 *
 * NOTE: the login endpoint in src/modules/auth still reads the removed feature-002 `users`
 * table, so these accounts cannot sign in through it until login is rebuilt on `accounts`.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const PASSWORD = 'ChangeMe123!';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    // Demo school (the student is a school account and must belong to one school).
    let school = (await client.query("SELECT school_id FROM schools WHERE name = 'Santulan Demo School'")).rows[0];
    if (!school) {
      school = (await client.query("INSERT INTO schools (name, status) VALUES ('Santulan Demo School', 'pilot') RETURNING school_id")).rows[0];
    }

    // Admin: a platform-level superuser, so no school.
    await client.query(
      `INSERT INTO accounts (account_type, role, status, email, name, password_hash)
       VALUES ('superuser', 'superuser', 'active', 'admin@santulan.local', 'Santulan Admin', $1)
       ON CONFLICT (email) DO NOTHING`,
      [passwordHash],
    );

    // Student: an account plus the student-only profile (school-issued login_id).
    await client.query(
      `INSERT INTO accounts (account_type, role, status, school_id, email, name, password_hash)
       VALUES ('school_user', 'student', 'active', $1, 'student@santulan.local', 'Demo Student', $2)
       ON CONFLICT (email) DO NOTHING`,
      [school.school_id, passwordHash],
    );
    const student = (await client.query("SELECT account_id FROM accounts WHERE email = 'student@santulan.local'")).rows[0];
    await client.query(
      `INSERT INTO student_profiles (account_id, login_id, class_name, section, onboarding_state)
       VALUES ($1, 'student001', '8', 'A', 'active')
       ON CONFLICT (account_id) DO NOTHING`,
      [student.account_id],
    );
    // onboarding_state 'active' presumes consent on file (schema doc, student_profiles comment).
    await client.query(
      `INSERT INTO consent_records (student_account_id, school_id, method, status, consent_date)
       SELECT $1, $2, 'seed', 'granted', CURRENT_DATE
        WHERE NOT EXISTS (SELECT 1 FROM consent_records WHERE student_account_id = $1)`,
      [student.account_id, school.school_id],
    );

    await client.query('COMMIT');
    console.log('Seeded platform demo data:'); // eslint-disable-line no-console
    console.log('  School : Santulan Demo School'); // eslint-disable-line no-console
    console.log(`  Admin  : admin@santulan.local   (password: ${PASSWORD})`); // eslint-disable-line no-console
    console.log(`  Student: login_id student001 / student@santulan.local   (password: ${PASSWORD})`); // eslint-disable-line no-console
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
