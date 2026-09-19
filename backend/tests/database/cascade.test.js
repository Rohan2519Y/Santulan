/*
 * Referential integrity and delete behaviour exactly as the doc's foreign keys define it
 * (doc section 5: "deleting an accounts row cascades correctly through every table that
 * references it" for student-owned records). Spec FR-037/038/039.
 */
const { withRolledBackTx } = require('./harness');

/** A student with a record in every student-scoped table. */
async function populatedStudent(tx, schoolId) {
  const student = await tx.student({ schoolId });
  const counsellor = await tx.staff({ role: 'counsellor', schoolId });
  const protocol = await tx.protocol();
  const module = await tx.module();
  const session = await tx.scpSession({ studentId: student });
  const rows = {
    student_profiles: ['account_id', student],
    consent_records: ['student_account_id', student],
    scp_consents: ['student_account_id', student],
    scp_sessions: ['student_account_id', student],
    scp_assents: ['student_account_id', student],
    escalation_events: ['student_account_id', student],
    counsellor_notes: ['student_account_id', student],
    queue_signals: ['student_account_id', student],
    protocol_route_events: ['student_account_id', student],
    module_completions: ['account_id', student],
    protocol_orientations: ['account_id', student],
    capability_grants: ['account_id', student],
    school_assignments: ['account_id', student],
  };
  await tx.consentRecord({ studentId: student, schoolId });
  await tx.scpConsent({ studentId: student, schoolId });
  await tx.assent({ studentId: student, sessionId: session });
  await tx.escalation({ studentId: student, schoolId });
  await tx.note({ counsellorId: counsellor, studentId: student });
  await tx.queueSignal({ studentId: student, schoolId });
  await tx.routeEvent({ practitionerId: counsellor, protocolId: protocol, studentId: student });
  await tx.completion({ accountId: student, moduleId: module });
  await tx.orientation({ accountId: student, protocolId: protocol });
  await tx.grant({ accountId: student, grantedBy: counsellor });
  await tx.assignment({ accountId: student, schoolId, role: 'teacher' });
  return { student, counsellor, protocol, rows };
}

const countFor = async (tx, table, col, id) => (await tx.q(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [id]))[0].n;

describe('referential integrity and deletes (doc section 5)', () => {
  test('deleting a student account cascades through every student-owned table', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const { student, rows } = await populatedStudent(tx, school);

      for (const [table, [col, id]] of Object.entries(rows)) {
        expect({ table, before: await countFor(tx, table, col, id) }).toEqual({ table, before: 1 });
      }
      await tx.exec('DELETE FROM accounts WHERE account_id = $1', [student]);
      for (const [table, [col, id]] of Object.entries(rows)) {
        expect({ table, after: await countFor(tx, table, col, id) }).toEqual({ table, after: 0 });
      }
    });
  });

  test('a parent\'s linked-student list is an array, not a foreign key: it keeps a deleted student\'s id', async () => {
    // Documented, accepted trade-off (doc section 1, "Pass four"): PostgreSQL cannot enforce a foreign
    // key per array element, so validating/cleaning this list is the application's job.
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const parent = await tx.parent({ schoolId: school, linked: [student] });
      await tx.exec('DELETE FROM accounts WHERE account_id = $1', [student]);
      const [p] = await tx.q('SELECT linked_student_account_ids AS ids FROM parent_profiles WHERE account_id = $1', [parent]);
      expect(p.ids).toEqual([student]);
    });
  });

  test('an account that authored retained records cannot be hard-deleted; it can be marked deleted', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      await tx.note({ counsellorId: counsellor, studentId: student });

      await tx.refused('DELETE FROM accounts WHERE account_id = $1', [counsellor], '23503');
      await tx.exec("UPDATE accounts SET status = 'deleted', deleted_at = now() WHERE account_id = $1", [counsellor]);
      const [c] = await tx.q('SELECT status, deleted_at FROM accounts WHERE account_id = $1', [counsellor]);
      expect(c.status).toBe('deleted');
      expect(c.deleted_at).not.toBeNull();
    });
  });

  test('audit rows keep their actor: an account named in the audit trail cannot be hard-deleted', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const teacher = await tx.staff({ role: 'teacher', schoolId: school });
      await tx.audit({ actorId: teacher, schoolId: school });
      await tx.refused('DELETE FROM accounts WHERE account_id = $1', [teacher], '23503');
    });
  });

  test('references must point at something that exists', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const ghost = '00000000-0000-0000-0000-000000000000';
      await tx.refused("INSERT INTO accounts (account_type, role, school_id, name, password_hash) VALUES ('school_user','teacher',$1,'n','x')", [ghost], '23503');
      await tx.refused('INSERT INTO consent_records (student_account_id, school_id, status) VALUES ($1, $2, $3)', [ghost, school, 'granted'], '23503');
      await tx.refused('INSERT INTO escalation_events (student_account_id, school_id, user_type, escalation_level, trigger_reason) VALUES ($1,$2,$3,3,$4)', [student, ghost, 'student', 'x'], '23503');
    });
  });

  test('a school that still has accounts cannot be deleted', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      await tx.student({ schoolId: school });
      await tx.refused('DELETE FROM schools WHERE school_id = $1', [school], '23503');
    });
  });

  test('a protocol that has been routed to cannot be deleted', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const { protocol } = await populatedStudent(tx, school);
      await tx.refused('DELETE FROM protocols WHERE protocol_id = $1', [protocol], '23503');
    });
  });
});
