const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const config = require('../../src/config');

/*
 * People are `accounts` now (docs/SQL-Database-Schema.md); the old `users` table is gone.
 * The tests still talk about "participant" and "admin"; those are a student account and a
 * superuser account. Accounts are created on the owner connection (DATABASE_URL) because
 * row-level security on `accounts` hides/blocks them for the app_runtime connection unless a
 * school is set - the application's own login path uses the platform-scope role for the same reason.
 */
const ACCOUNT_ROLE = { participant: 'student', admin: 'superuser' };
const TEST_SCHOOL = 'Assessment Test School';

async function withOwner(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const signToken = (account) =>
  jwt.sign({ sub: account.id, role: account.role, email: account.email, schoolId: account.schoolId }, config.jwtSecret, { expiresIn: '1h' });

async function createUserWithToken(role = 'participant') {
  const accountRole = ACCOUNT_ROLE[role] || role;
  const email = `${role}-${randomUUID()}@test.local`;
  const passwordHash = await bcrypt.hash('Test1234!', 4);

  const user = await withOwner(async (db) => {
    let schoolId = null;
    if (accountRole !== 'superuser') {
      const found = await db.query('SELECT school_id FROM schools WHERE name = $1', [TEST_SCHOOL]);
      schoolId = found.rows[0]?.school_id ?? (await db.query('INSERT INTO schools (name) VALUES ($1) RETURNING school_id', [TEST_SCHOOL])).rows[0].school_id;
    }
    const { rows } = await db.query(
      `INSERT INTO accounts (account_type, role, status, school_id, email, name, password_hash)
       VALUES ($1, $2, 'active', $3, $4, $5, $6) RETURNING account_id`,
      [accountRole === 'superuser' ? 'superuser' : 'school_user', accountRole, schoolId, email, `Test ${role}`, passwordHash],
    );
    const id = rows[0].account_id;
    if (accountRole === 'student') await db.query('INSERT INTO student_profiles (account_id) VALUES ($1)', [id]);
    return { id, email, role: accountRole, schoolId };
  });

  return { user, token: signToken(user) };
}

async function getAdminToken() {
  const admin = await withOwner(async (db) => {
    const { rows } = await db.query("SELECT account_id, email, role, school_id FROM accounts WHERE email = 'admin@santulan.local'");
    return rows[0] && { id: rows[0].account_id, email: rows[0].email, role: rows[0].role, schoolId: rows[0].school_id };
  });
  if (!admin) throw new Error('Seed the database first: npm run db:seed:platform');
  return { user: admin, token: signToken(admin) };
}

module.exports = { createUserWithToken, getAdminToken };
