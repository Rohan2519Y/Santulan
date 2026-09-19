/*
 * Tenant isolation exactly as docs/SQL-Database-Schema.md section 4 defines it: row-level
 * security on each school-owned table (every table with a school_id column), keyed on
 * app.current_school_id. Isolation only applies to a non-owner role, so every assertion
 * here runs as app_runtime; the owner (a superuser) stands in for the document's
 * "platform-scope connection that bypasses RLS".
 */
const { withRolledBackTx } = require('./harness');

const SCHOOL_OWNED_TABLES = [
  'accounts', 'school_assignments', 'escalation_events', 'consent_records',
  'scp_consents', 'queue_signals', 'class_guidance_state', 'group_sessions',
];

/** Two schools, each with one row in every school-owned table. */
async function twoSchools(tx) {
  const build = async (schoolId, label) => {
    const student = await tx.student({ schoolId });
    const counsellor = await tx.staff({ role: 'counsellor', schoolId });
    await tx.assignment({ accountId: counsellor, schoolId });
    const escalation = await tx.escalation({ studentId: student, schoolId });
    const consent = await tx.consentRecord({ studentId: student, schoolId });
    await tx.scpConsent({ studentId: student, schoolId });
    await tx.queueSignal({ studentId: student, schoolId });
    await tx.guidance({ schoolId, classLabel: `class-${label}` });
    await tx.groupSession({ counsellorId: counsellor, schoolId });
    return { schoolId, student, counsellor, escalation, consent };
  };
  const A = await build(await tx.school({ name: 'School A' }), 'A');
  const B = await build(await tx.school({ name: 'School B' }), 'B');
  return { A, B };
}

describe('tenant isolation (doc section 4)', () => {
  test('with no school set, every school-owned table returns zero rows', async () => {
    await withRolledBackTx(async (tx) => {
      await twoSchools(tx);
      await tx.asRole('app_runtime');
      await tx.clearScope();
      for (const table of SCHOOL_OWNED_TABLES) {
        const [{ n }] = await tx.q(`SELECT count(*)::int AS n FROM ${table}`);
        expect({ table, n }).toEqual({ table, n: 0 });
      }
    });
  });

  test('acting for school A returns only school A rows - with and without a school filter', async () => {
    await withRolledBackTx(async (tx) => {
      const { A, B } = await twoSchools(tx);
      await tx.asRole('app_runtime');
      await tx.scope(A.schoolId);
      for (const table of SCHOOL_OWNED_TABLES) {
        // A query that "forgets" its school filter - the exact bug this design exists to remove.
        const unfiltered = await tx.q(`SELECT school_id FROM ${table}`);
        expect({ table, rows: unfiltered.length > 0 }).toEqual({ table, rows: true });
        expect({ table, foreign: unfiltered.filter((r) => r.school_id !== A.schoolId).length }).toEqual({ table, foreign: 0 });

        const forB = await tx.q(`SELECT 1 FROM ${table} WHERE school_id = $1`, [B.schoolId]);
        expect({ table, forB: forB.length }).toEqual({ table, forB: 0 });
      }
    });
  });

  test('a school cannot write another school\'s rows', async () => {
    await withRolledBackTx(async (tx) => {
      const { A, B } = await twoSchools(tx);
      await tx.asRole('app_runtime');
      await tx.scope(A.schoolId);

      // INSERT of a school-B row while acting for A is refused by the policy.
      await tx.refused(
        `INSERT INTO escalation_events (student_account_id, school_id, user_type, escalation_level, trigger_reason)
         VALUES ($1, $2, 'student', 3, 'x')`,
        [B.student, B.schoolId],
        '42501',
      );
      await tx.refused(
        `INSERT INTO consent_records (student_account_id, school_id, status) VALUES ($1, $2, 'granted')`,
        [B.student, B.schoolId],
        '42501',
      );
      await tx.refused(
        `INSERT INTO accounts (account_type, role, status, school_id, name, password_hash) VALUES ('school_user', 'teacher', 'active', $1, 'x', 'x')`,
        [B.schoolId],
        '42501',
      );

      // Moving a visible school-A row into school B is refused too.
      await tx.refused('UPDATE escalation_events SET school_id = $1 WHERE escalation_id = $2', [B.schoolId, A.escalation], '42501');

      // UPDATE / DELETE aimed at a school-B row silently affect nothing: the row is invisible.
      const upd = await tx.exec("UPDATE escalation_events SET trigger_reason = 'hacked' WHERE escalation_id = $1", [B.escalation]);
      const del = await tx.exec('DELETE FROM consent_records WHERE consent_id = $1', [B.consent]);
      expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);

      await tx.asOwner();
      const [row] = await tx.q('SELECT trigger_reason FROM escalation_events WHERE escalation_id = $1', [B.escalation]);
      expect(row.trigger_reason).toBe('test reason');
      expect(await tx.q('SELECT 1 FROM consent_records WHERE consent_id = $1', [B.consent])).toHaveLength(1);
    });
  });

  test('the platform-scope connection (owner / BYPASSRLS) sees every school', async () => {
    await withRolledBackTx(async (tx) => {
      const { A, B } = await twoSchools(tx);
      await tx.asOwner();
      for (const table of SCHOOL_OWNED_TABLES) {
        const schools = new Set((await tx.q(`SELECT school_id FROM ${table} WHERE school_id = ANY($1)`, [[A.schoolId, B.schoolId]])).map((r) => r.school_id));
        expect({ table, both: schools.size }).toEqual({ table, both: 2 });
      }
    });
  });

  test('exactly the school-owned tables carry the tenant_isolation policy; global catalogs do not', async () => {
    await withRolledBackTx(async (tx) => {
      const policies = await tx.q("SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' ORDER BY tablename");
      expect(policies.map((p) => p.tablename)).toEqual([...SCHOOL_OWNED_TABLES].sort());

      const rls = await tx.q(
        `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
        [SCHOOL_OWNED_TABLES],
      );
      expect(rls.filter((r) => !r.relrowsecurity)).toEqual([]);

      // Global catalogs (no school_id) are visible to any connection.
      await tx.protocol({ code: 'GLOBAL-1' });
      await tx.module({ title: 'Global module' });
      await tx.asRole('app_runtime');
      await tx.clearScope();
      expect(await tx.q("SELECT 1 FROM protocols WHERE protocol_code = 'GLOBAL-1'")).toHaveLength(1);
      expect(await tx.q("SELECT 1 FROM content_modules WHERE title = 'Global module'")).toHaveLength(1);
    });
  });
});
