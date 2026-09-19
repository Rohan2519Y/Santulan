const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const platformDb = require('../../shared/platformDb');
const config = require('../../config');
const { validate } = require('../../shared/utils/validate');
const { HttpError } = require('../../shared/errors');

const router = Router();

/*
 * Login against the platform schema (docs/SQL-Database-Schema.md): one account per person.
 *   - students sign in with the school-issued `loginId` (student_profiles.login_id), or their email;
 *   - staff, parents and admins sign in with their email (staff may use their work email).
 * The lookup runs on the platform-scope connection because it happens before any school is known
 * and so cannot pass row-level security on `accounts`.
 */
const loginSchema = z
  .object({
    email: z.string().email().optional(),
    loginId: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((v) => v.email || v.loginId, { message: 'email or loginId is required' });

const ACCOUNT_COLUMNS = `a.account_id, a.role, a.status, a.school_id, a.email, a.name, a.password_hash, p.login_id`;

// A real bcrypt hash to compare against when no account matches, so "unknown login" and
// "wrong password" take the same time and cannot be told apart.
const DUMMY_HASH = bcrypt.hashSync('no-such-account', 10);

async function findAccounts({ email, loginId }) {
  if (loginId) {
    return platformDb.query(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM student_profiles p JOIN accounts a ON a.account_id = p.account_id
        WHERE p.login_id = $1`,
      [loginId],
    );
  }
  return platformDb.query(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts a
       LEFT JOIN student_profiles p ON p.account_id = a.account_id
       LEFT JOIN staff_profiles s ON s.account_id = a.account_id
      WHERE lower(a.email) = lower($1) OR lower(s.work_email) = lower($1)`,
    [email],
  );
}

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { rows } = await findAccounts(req.body);
    // Exactly one match, otherwise treat as unknown (an ambiguous email must not pick an account).
    const account = rows.length === 1 ? rows[0] : null;

    const passwordOk = await bcrypt.compare(req.body.password, account?.passwordHash || DUMMY_HASH);
    // Only active accounts with a password can sign in (pending/suspended/locked/deleted cannot).
    if (!account || !account.passwordHash || !passwordOk || account.status !== 'active') {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid login or password');
    }

    await platformDb.query('UPDATE accounts SET last_login_at = now() WHERE account_id = $1', [account.accountId]);

    const token = jwt.sign(
      { sub: account.accountId, role: account.role, email: account.email, schoolId: account.schoolId },
      config.jwtSecret,
      { expiresIn: '12h' },
    );
    res.json({
      token,
      user: {
        id: account.accountId,
        email: account.email,
        name: account.name,
        role: account.role,
        schoolId: account.schoolId,
        loginId: account.loginId,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
