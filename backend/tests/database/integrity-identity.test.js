/*
 * US3 - schools, people, roles: the identity/assignment/permission rules that the doc's DDL
 * (section 3.1) defines. Every refusal asserted here comes from a constraint in that DDL.
 */
const { withRolledBackTx } = require('./harness');

const INSERT_ACCOUNT = `INSERT INTO accounts (account_type, role, status, school_id, email, mobile, name, password_hash)
                        VALUES ($1, $2, $3, $4, $5, $6, 'n', $7) RETURNING account_id`;

describe('US3: identity, roles, assignments, grants', () => {
  test('a parent account starts pending with no password and activates in place', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const parent = await tx.parent({ schoolId: school, status: 'pending', passwordHash: null, linked: [student] });

      // Not pending any more, so a password is required.
      await tx.refused("UPDATE accounts SET status = 'active' WHERE account_id = $1", [parent], '23514');
      // Same account row activates once it has a password.
      await tx.exec("UPDATE accounts SET status = 'active', password_hash = 'hash' WHERE account_id = $1", [parent]);
      const [row] = await tx.q('SELECT status, password_hash FROM accounts WHERE account_id = $1', [parent]);
      expect(row).toEqual({ status: 'active', password_hash: 'hash' });

      // An active account can never be created without a password either.
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'parent', 'active', school, null, null, null], '23514');
    });
  });

  test('a school account needs a school; a platform account must not have one', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'teacher', 'active', null, null, null, 'x'], '23514');
      await tx.refused(INSERT_ACCOUNT, ['platform_staff', 'support', 'active', school, null, null, 'x'], '23514');
      await tx.refused(INSERT_ACCOUNT, ['superuser', 'superuser', 'active', school, null, null, 'x'], '23514');
      // The valid shapes are accepted.
      await tx.exec(INSERT_ACCOUNT, ['school_user', 'teacher', 'active', school, null, null, 'x']);
      await tx.exec(INSERT_ACCOUNT, ['platform_staff', 'support', 'active', null, null, null, 'x']);
      await tx.exec(INSERT_ACCOUNT, ['superuser', 'superuser', 'active', null, null, null, 'x']);
    });
  });

  test('email, mobile, student login_id and staff work_email are unique', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      await tx.account({ schoolId: school, role: 'teacher', email: 'dup@test.local', mobile: '9000000001' });
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'teacher', 'active', school, 'dup@test.local', null, 'x'], '23505');
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'teacher', 'active', school, null, '9000000001', 'x'], '23505');

      await tx.student({ schoolId: school, loginId: 'LOGIN-1' });
      const other = await tx.account({ schoolId: school, role: 'student' });
      await tx.refused('INSERT INTO student_profiles (account_id, login_id) VALUES ($1, $2)', [other, 'LOGIN-1'], '23505');
      // login_id may be NULL (not yet issued) for any number of students.
      await tx.exec('INSERT INTO student_profiles (account_id, login_id) VALUES ($1, NULL)', [other]);

      await tx.staff({ schoolId: school, workEmail: 'work@test.local' });
      const other2 = await tx.account({ schoolId: school, role: 'counsellor' });
      await tx.refused('INSERT INTO staff_profiles (account_id, work_email) VALUES ($1, $2)', [other2, 'work@test.local'], '23505');
    });
  });

  test('role, status and account type only accept the documented values', async () => {
    await withRolledBackTx(async (tx) => {
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'astronaut', 'active', null, null, null, 'x'], '22P02');
      await tx.refused(INSERT_ACCOUNT, ['school_user', 'teacher', 'vanished', null, null, null, 'x'], '22P02');
      await tx.refused(INSERT_ACCOUNT, ['tenant_admin', 'teacher', 'active', null, null, null, 'x'], '22P02');
    });
  });

  test('student and parent profile value rules', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const acct = await tx.account({ schoolId: school, role: 'student' });
      await tx.refused('INSERT INTO student_profiles (account_id, escalation_level) VALUES ($1, 0)', [acct], '23514');
      await tx.refused('INSERT INTO student_profiles (account_id, escalation_level) VALUES ($1, 6)', [acct], '23514');
      await tx.refused("INSERT INTO student_profiles (account_id, onboarding_state) VALUES ($1, 'bogus')", [acct], '23514');
      await tx.exec('INSERT INTO student_profiles (account_id, escalation_level) VALUES ($1, 5)', [acct]);
      const [p] = await tx.q('SELECT onboarding_state, escalation_level, interaction_count FROM student_profiles WHERE account_id = $1', [acct]);
      expect(p).toEqual({ onboarding_state: 'dormant', escalation_level: 5, interaction_count: 0 });

      const pa = await tx.account({ schoolId: school, role: 'parent' });
      await tx.refused("INSERT INTO parent_profiles (account_id, relation_type) VALUES ($1, 'uncle')", [pa], '23514');
      await tx.exec("INSERT INTO parent_profiles (account_id, relation_type) VALUES ($1, 'guardian')", [pa]);
    });
  });

  test('one parent record holds many students, and a student can be linked from several parents', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const s1 = await tx.student({ schoolId: school });
      const s2 = await tx.student({ schoolId: school });
      const mother = await tx.parent({ schoolId: school, linked: [s1, s2] });
      const father = await tx.parent({ schoolId: school, linked: [s1] });

      const [m] = await tx.q('SELECT linked_student_account_ids AS ids FROM parent_profiles WHERE account_id = $1', [mother]);
      expect(m.ids.sort()).toEqual([s1, s2].sort());
      // Reverse lookup through the GIN-indexed array: who is linked to s1?
      const linkedTo1 = await tx.q('SELECT account_id FROM parent_profiles WHERE linked_student_account_ids @> ARRAY[$1]::uuid[]', [s1]);
      expect(linkedTo1.map((r) => r.account_id).sort()).toEqual([mother, father].sort());
    });
  });

  test('a school has at most one active principal; revoking keeps the history row', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const p1 = await tx.staff({ role: 'principal', schoolId: school });
      const p2 = await tx.staff({ role: 'principal', schoolId: school });
      const first = await tx.assignment({ accountId: p1, schoolId: school, role: 'principal' });

      await tx.refused(
        "INSERT INTO school_assignments (account_id, school_id, assignment_role) VALUES ($1, $2, 'principal')",
        [p2, school],
        '23505',
      );

      await tx.exec('UPDATE school_assignments SET revoked_at = now() WHERE assignment_id = $1', [first]);
      await tx.exec("INSERT INTO school_assignments (account_id, school_id, assignment_role) VALUES ($1, $2, 'principal')", [p2, school]);

      const [old] = await tx.q('SELECT revoked_at FROM school_assignments WHERE assignment_id = $1', [first]);
      expect(old.revoked_at).not.toBeNull();
      // Counsellors and teachers are not limited to one.
      const c1 = await tx.staff({ role: 'counsellor', schoolId: school });
      const c2 = await tx.staff({ role: 'counsellor', schoolId: school });
      await tx.assignment({ accountId: c1, schoolId: school, role: 'counsellor' });
      await tx.assignment({ accountId: c2, schoolId: school, role: 'counsellor' });
    });
  });

  test('capability grants: field allowlist only on update; closed resource list', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const admin = await tx.account({ role: 'superuser' });
      const who = await tx.staff({ schoolId: school });
      const INSERT_GRANT = `INSERT INTO capability_grants (account_id, resource, action, fields, scope_type, scope_id, granted_by)
                            VALUES ($1, $2, $3, $4, 'school', 'x', $5)`;

      await tx.refused(INSERT_GRANT, [who, 'student', 'list', ['name'], admin], '23514');
      await tx.exec(INSERT_GRANT, [who, 'student', 'update', ['name'], admin]);
      await tx.exec(INSERT_GRANT, [who, 'student', 'list', null, admin]);

      // Removed features are not grantable resources.
      for (const removed of ['assessment', 'pulse', 'sathi']) await tx.refused(INSERT_GRANT, [who, removed, 'read', null, admin], '22P02');

      // Expiry and revocation are stored with who granted it.
      const id = await tx.grant({ accountId: who, grantedBy: admin, expiresAt: '2030-01-01T00:00:00Z' });
      await tx.exec('UPDATE capability_grants SET revoked_at = now() WHERE grant_id = $1', [id]);
      const [g] = await tx.q('SELECT granted_by, expires_at, revoked_at FROM capability_grants WHERE grant_id = $1', [id]);
      expect(g.granted_by).toBe(admin);
      expect(g.expires_at).not.toBeNull();
      expect(g.revoked_at).not.toBeNull();
    });
  });
});
