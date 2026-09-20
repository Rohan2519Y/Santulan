/*
 * DEV identity adapter (spec 005 decision D-17). Production replaces this with the managed identity provider; Santulan
 * itself never stores passwords or OTPs in the canonical schema (BUILD 03, Constitution VIII).
 *
 *  - OTP: in-memory, never persisted, single use, expires (default 10 min), attempt- and rate-limited per identity.
 *  - Passwords / temporary credentials: bcrypt hashes in dev_identity.credentials (created by scripts/dev-identity-setup.js,
 *    outside the 28 canonical tables). A temporary credential has must_change = true; setting a new password clears it and
 *    the old secret can never be used again.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PROVIDER = 'santulan-dev';
const OTP_PROVIDER = 'santulan-dev-otp';
const DUMMY_HASH = bcrypt.hashSync('no-such-credential', 10);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Normalises an OTP identity to a stable, non-reversible provider subject. */
function otpSubject(channel, identity) {
  const norm = channel === 'email' ? String(identity).trim().toLowerCase() : String(identity).replace(/[\s()-]/g, '');
  return sha256(`${channel}:${norm}`);
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'at least 10 characters';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'letters and digits';
  return null;
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out}7`; // always contains letters and a digit
}

function createDevProvider({ db, now = () => Date.now(), otpTtlMs = 10 * 60 * 1000, otpMaxAttempts = 5, otpMaxRequestsPerHour = 5, log = () => {} } = {}) {
  const otps = new Map();      // subject -> { hash, expiresAt, attempts }
  const requests = new Map();  // subject -> [timestamps]

  return {
    PROVIDER,
    OTP_PROVIDER,
    otpSubject,
    passwordProblem,

    // ------------------------------------------------------------ OTP
    requestOtp(channel, identity) {
      const subject = otpSubject(channel, identity);
      const t = now();
      const recent = (requests.get(subject) || []).filter((x) => x > t - 3600 * 1000);
      if (recent.length >= otpMaxRequestsPerHour) return { sent: false, rateLimited: true };
      recent.push(t);
      requests.set(subject, recent);
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      otps.set(subject, { hash: sha256(`${subject}:${code}`), expiresAt: t + otpTtlMs, attempts: 0 });
      log(channel, code);
      return { sent: true, rateLimited: false, _code: code };
    },

    /** Returns true once, for the correct unexpired code; the code is then destroyed (replay protection). */
    verifyOtp(channel, identity, code) {
      const subject = otpSubject(channel, identity);
      const entry = otps.get(subject);
      if (!entry || now() > entry.expiresAt) { otps.delete(subject); return { ok: false, subject }; }
      entry.attempts += 1;
      if (entry.attempts > otpMaxAttempts) { otps.delete(subject); return { ok: false, subject }; }
      const ok = crypto.timingSafeEqual(Buffer.from(entry.hash), Buffer.from(sha256(`${subject}:${String(code)}`)));
      if (ok) otps.delete(subject);
      return { ok, subject };
    },

    // ------------------------------------------------------------ passwords / temporary credentials
    async authenticate(subjectId, password) {
      const { rows } = await db.query('SELECT secret_hash, must_change, status FROM dev_identity.credentials WHERE provider = $1 AND subject_id = $2', [PROVIDER, subjectId]);
      const row = rows[0];
      const ok = await bcrypt.compare(String(password || ''), row ? row.secretHash : DUMMY_HASH);   // equal timing for unknown ids
      if (!row || !ok || row.status !== 'active') return { ok: false, mustChange: false };
      return { ok: true, mustChange: row.mustChange };
    },

    /** Issues a new temporary credential; any previous secret stops working immediately. The plaintext is returned once. */
    async issueTemporaryCredential(subjectId) {
      const temp = generateTemporaryPassword();
      await db.query(
        `INSERT INTO dev_identity.credentials (provider, subject_id, secret_hash, must_change, status) VALUES ($1, $2, $3, true, 'active')
         ON CONFLICT (provider, subject_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, must_change = true, status = 'active', updated_at = now()`,
        [PROVIDER, subjectId, await bcrypt.hash(temp, 10)],
      );
      return temp;
    },

    /** Replaces a TEMPORARY credential only (must_change = true), so a set-password token is effectively single use. */
    async setPassword(subjectId, newPassword) {
      const problem = passwordProblem(newPassword);
      if (problem) return { ok: false, problem };
      const hash = await bcrypt.hash(newPassword, 10);
      const { rowCount } = await db.query(
        `UPDATE dev_identity.credentials SET secret_hash = $3, must_change = false, updated_at = now()
          WHERE provider = $1 AND subject_id = $2 AND must_change = true AND status = 'active'`,
        [PROVIDER, subjectId, hash],
      );
      return { ok: rowCount > 0, problem: rowCount > 0 ? null : 'no temporary credential to replace' };
    },

    async revoke(subjectId) {
      await db.query(`UPDATE dev_identity.credentials SET status = 'disabled', updated_at = now() WHERE provider = $1 AND subject_id = $2`, [PROVIDER, subjectId]);
    },
  };
}

module.exports = { createDevProvider, PROVIDER, OTP_PROVIDER, otpSubject, passwordProblem };
