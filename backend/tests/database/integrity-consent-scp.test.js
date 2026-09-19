/*
 * US4 - consent, assent and SCP sessions, as the doc's DDL (sections 3.3-3.5) defines them.
 */
const { withRolledBackTx } = require('./harness');

describe('US4: consent, assent, SCP sessions', () => {
  test('onboarding consent and SCP consent are two separate record types', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const parent = await tx.parent({ schoolId: school, linked: [student] });
      const general = await tx.consentRecord({ studentId: student, schoolId: school });
      const scp = await tx.scpConsent({ studentId: student, schoolId: school, parentId: parent, academicYear: '2026-27' });

      const [c] = await tx.q('SELECT academic_year, valid_from, valid_until, parent_account_id FROM scp_consents WHERE consent_id = $1', [scp]);
      expect(c.academic_year).toBe('2026-27');
      expect(c.valid_from).not.toBeNull();
      expect(c.valid_until).not.toBeNull();
      expect(c.parent_account_id).toBe(parent);

      // SCP consent is renewable per academic year: a second year is a second row.
      await tx.scpConsent({ studentId: student, schoolId: school, parentId: parent, academicYear: '2027-28' });
      expect(await tx.q('SELECT 1 FROM scp_consents WHERE student_account_id = $1', [student])).toHaveLength(2);

      // Withdrawal is recorded with a reason on either kind of consent.
      await tx.exec("UPDATE scp_consents SET withdrawn_at = now(), withdrawn_reason = 'parent request' WHERE consent_id = $1", [scp]);
      await tx.exec("UPDATE consent_records SET withdrawn_at = now(), withdrawn_reason = 'moved school' WHERE consent_id = $1", [general]);
      const [w] = await tx.q('SELECT withdrawn_reason FROM scp_consents WHERE consent_id = $1', [scp]);
      expect(w.withdrawn_reason).toBe('parent request');

      // Both consents need a status (NOT NULL).
      await tx.refused('INSERT INTO consent_records (student_account_id, school_id) VALUES ($1, $2)', [student, school], '23502');
      await tx.refused('INSERT INTO scp_consents (student_account_id, school_id) VALUES ($1, $2)', [student, school], '23502');
    });
  });

  test('an SCP session stores progress, sealed answers, scores and a void', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const session = await tx.scpSession({
        studentId: student,
        responses: { item_1: 'sealed-a', item_2: 'sealed-b' },
        scores: { D1: { stage: 'developing', validity_outcome: 'valid' } },
      });

      const [s] = await tx.q('SELECT resume_count, answered_count, device_shared, item_responses_sealed, domain_scores FROM scp_sessions WHERE session_id = $1', [session]);
      expect(s.resume_count).toBe(0);
      expect(s.answered_count).toBe(0);
      expect(s.device_shared).toBe(false);
      expect(s.item_responses_sealed).toEqual({ item_1: 'sealed-a', item_2: 'sealed-b' });
      expect(s.domain_scores.D1.stage).toBe('developing');

      await tx.exec("UPDATE scp_sessions SET answered_count = 2, total_items = 40, resume_count = 1, voided_at = now(), voided_by = $2, void_reason = 'device shared' WHERE session_id = $1", [session, counsellor]);
      const [v] = await tx.q('SELECT voided_by, void_reason, voided_at FROM scp_sessions WHERE session_id = $1', [session]);
      expect(v.voided_by).toBe(counsellor);
      expect(v.void_reason).toBe('device shared');
      expect(v.voided_at).not.toBeNull();

      await tx.refused('INSERT INTO scp_sessions (student_account_id, state) VALUES ($1, $2)', [student, 'x'], '23502'); // checkpoint
      await tx.refused('INSERT INTO scp_sessions (student_account_id, checkpoint) VALUES ($1, $2)', [student, 'CP1'], '23502'); // state
    });
  });

  test('sealed data has no plain-text counterpart column (FR-020)', async () => {
    await withRolledBackTx(async (tx) => {
      const cols = async (t) => (await tx.q('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position', [t]));
      const notes = await cols('counsellor_notes');
      expect(notes.find((c) => c.column_name === 'content_sealed').data_type).toBe('bytea');
      expect(notes.map((c) => c.column_name)).toEqual(['note_id', 'counsellor_account_id', 'student_account_id', 'content_sealed', 'created_at']);
      const sessions = await cols('scp_sessions');
      expect(sessions.find((c) => c.column_name === 'item_responses_sealed').data_type).toBe('jsonb');
      expect(sessions.map((c) => c.column_name)).not.toContain('item_responses');

      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      await tx.refused('INSERT INTO counsellor_notes (counsellor_account_id, student_account_id, content_sealed) VALUES ($1, $2, NULL)', [counsellor, student], '23502');
    });
  });

  test('there is exactly one assent per session; a decline is stored; deleting the session removes it', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const session = await tx.scpSession({ studentId: student });
      await tx.assent({ studentId: student, sessionId: session, assented: true });

      await tx.refused('INSERT INTO scp_assents (student_account_id, session_id, assented) VALUES ($1, $2, false)', [student, session], '23505');

      const other = await tx.scpSession({ studentId: student, checkpoint: 'CP2' });
      await tx.exec('INSERT INTO scp_assents (student_account_id, session_id, assented, declined_at) VALUES ($1, $2, false, now())', [student, other]);
      const [d] = await tx.q('SELECT assented, declined_at FROM scp_assents WHERE session_id = $1', [other]);
      expect(d.assented).toBe(false);
      expect(d.declined_at).not.toBeNull();

      await tx.exec('DELETE FROM scp_sessions WHERE session_id = $1', [session]);
      expect(await tx.q('SELECT 1 FROM scp_assents WHERE session_id = $1', [session])).toHaveLength(0);
    });
  });

  test('the latest session per checkpoint is retrievable', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      await tx.scpSession({ studentId: student, checkpoint: 'CP1', completedAt: '2026-01-01T00:00:00Z' });
      const newer = await tx.scpSession({ studentId: student, checkpoint: 'CP1', completedAt: '2026-02-01T00:00:00Z' });
      const cp2 = await tx.scpSession({ studentId: student, checkpoint: 'CP2', completedAt: '2026-01-15T00:00:00Z' });

      const latest = await tx.q(
        `SELECT DISTINCT ON (checkpoint) checkpoint, session_id FROM scp_sessions
          WHERE student_account_id = $1 ORDER BY checkpoint, completed_at DESC`,
        [student],
      );
      expect(latest).toEqual([
        { checkpoint: 'CP1', session_id: newer },
        { checkpoint: 'CP2', session_id: cp2 },
      ]);
    });
  });
});
