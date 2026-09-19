/*
 * Login against the platform schema. Uses the app over HTTP (supertest) and real database rows:
 * accounts are created here with the owner connection and removed in afterAll, so the test does
 * not depend on the demo seed.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
const app = require('../../../src/app');
const config = require('../../../src/config');
const db = require('../../../src/shared/db');
const platformDb = require('../../../src/shared/platformDb');

const PASSWORD = 'Sup3r-Secret!';
const tag = randomUUID().slice(0, 8);
const ids = { school: null, accounts: [] };
let owner;

async function makeAccount({ role = 'student', status = 'active', password = PASSWORD, loginId = null, workEmail = null }) {
  const accountType = role === 'superuser' ? 'superuser' : 'school_user';
  const email = `${role}-${status}-${tag}-${randomUUID().slice(0, 4)}@login.test`;
  const hash = password === null ? null : await bcrypt.hash(password, 4);
  const { rows } = await owner.query(
    `INSERT INTO accounts (account_type, role, status, school_id, email, name, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING account_id`,
    [accountType, role, status, accountType === 'school_user' ? ids.school : null, email, `${role} ${tag}`, hash],
  );
  const accountId = rows[0].account_id;
  ids.accounts.push(accountId);
  if (role === 'student') await owner.query('INSERT INTO student_profiles (account_id, login_id) VALUES ($1, $2)', [accountId, loginId]);
  if (workEmail) await owner.query('INSERT INTO staff_profiles (account_id, work_email) VALUES ($1, $2)', [accountId, workEmail]);
  return { accountId, email };
}

const post = (body) => request(app).post('/api/v1/auth/login').send(body);

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  ids.school = (await owner.query("INSERT INTO schools (name) VALUES ($1) RETURNING school_id", [`Login Test School ${tag}`])).rows[0].school_id;
});

afterAll(async () => {
  // Children first (student_profiles / staff_profiles cascade with the account), then school.
  if (ids.accounts.length) await owner.query('DELETE FROM accounts WHERE account_id = ANY($1)', [ids.accounts]);
  await owner.query('DELETE FROM schools WHERE school_id = $1', [ids.school]);
  await owner.end();
  await db.pool.end();
  await platformDb.pool.end();
});

describe('POST /api/v1/auth/login (platform accounts)', () => {
  test('a student signs in with the school-issued login id', async () => {
    const loginId = `stu-${tag}`;
    const { accountId } = await makeAccount({ role: 'student', loginId });
    const res = await post({ loginId, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: accountId, role: 'student', schoolId: ids.school, loginId });
    const claims = jwt.verify(res.body.token, config.jwtSecret);
    expect(claims).toMatchObject({ sub: accountId, role: 'student', schoolId: ids.school });
  });

  test('a student can also sign in with their email', async () => {
    const { email } = await makeAccount({ role: 'student', loginId: `stu2-${tag}` });
    const res = await post({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('student');
  });

  test('an admin (superuser, no school) signs in with email', async () => {
    const { email } = await makeAccount({ role: 'superuser' });
    const res = await post({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'superuser', schoolId: null });
  });

  test('staff can sign in with their work email', async () => {
    const workEmail = `work-${tag}@school.test`;
    await makeAccount({ role: 'counsellor', workEmail });
    const res = await post({ email: workEmail, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('counsellor');
  });

  test('sign-in stamps last_login_at', async () => {
    const loginId = `stamp-${tag}`;
    const { accountId } = await makeAccount({ role: 'student', loginId });
    const before = (await owner.query('SELECT last_login_at FROM accounts WHERE account_id = $1', [accountId])).rows[0];
    expect(before.last_login_at).toBeNull();
    await post({ loginId, password: PASSWORD }).expect(200);
    const after = (await owner.query('SELECT last_login_at FROM accounts WHERE account_id = $1', [accountId])).rows[0];
    expect(after.last_login_at).not.toBeNull();
  });

  test('a wrong password and an unknown login give the same 401', async () => {
    const loginId = `wrong-${tag}`;
    await makeAccount({ role: 'student', loginId });
    const wrong = await post({ loginId, password: 'not-it' });
    const unknown = await post({ loginId: `nobody-${tag}`, password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.code).toBe('UNAUTHENTICATED');
  });

  test.each(['pending', 'suspended', 'locked', 'deleted'])('a %s account cannot sign in', async (status) => {
    const loginId = `st-${status}-${tag}`;
    // pending accounts have no password yet; the others keep theirs.
    await makeAccount({ role: 'student', status, loginId, password: status === 'pending' ? null : PASSWORD });
    const res = await post({ loginId, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  test('email or loginId is required, and the password is required', async () => {
    expect((await post({ password: PASSWORD })).status).toBe(400);
    expect((await post({ loginId: 'x' })).status).toBe(400);
    expect((await post({ email: 'not-an-email', password: PASSWORD })).status).toBe(400);
  });

  test('the platform connection can see accounts that the runtime connection cannot (row-level security)', async () => {
    const loginId = `rls-${tag}`;
    const { accountId } = await makeAccount({ role: 'student', loginId });
    // app_runtime with no school set sees no accounts at all...
    const viaRuntime = await db.query('SELECT 1 FROM accounts WHERE account_id = $1', [accountId]);
    expect(viaRuntime.rowCount).toBe(0);
    // ...which is why login uses the platform-scope connection.
    const viaPlatform = await platformDb.query('SELECT 1 FROM accounts WHERE account_id = $1', [accountId]);
    expect(viaPlatform.rowCount).toBe(1);
  });
});
