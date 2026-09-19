/*
 * US5 - safeguarding, counsellor notes, attention queue, class guidance (doc sections 3.3, 3.7).
 */
const { withRolledBackTx } = require('./harness');

const INSERT_ESCALATION = `INSERT INTO escalation_events (student_account_id, school_id, user_type, escalation_level, trigger_reason, status)
                           VALUES ($1, $2, 'student', $3, $4, $5)`;

describe('US5: safeguarding and guidance', () => {
  test('escalation severity is 3-5 and status is open / acknowledged / resolved', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      for (const level of [1, 2, 6]) await tx.refused(INSERT_ESCALATION, [student, school, level, 'r', 'open'], '23514');
      await tx.refused(INSERT_ESCALATION, [student, school, 3, 'r', 'closed'], '23514');
      await tx.refused(INSERT_ESCALATION, [student, school, 3, null, 'open'], '23502');
      for (const level of [3, 4, 5]) await tx.exec(INSERT_ESCALATION, [student, school, level, 'r', 'open']);
      // status defaults to open
      await tx.exec("INSERT INTO escalation_events (student_account_id, school_id, user_type, escalation_level, trigger_reason) VALUES ($1,$2,'student',4,'r')", [student, school]);
      const [d] = await tx.q("SELECT status FROM escalation_events WHERE trigger_reason = 'r' AND escalation_level = 4 ORDER BY created_at DESC LIMIT 1");
      expect(d.status).toBe('open');
    });
  });

  test('an escalation records who acknowledged and resolved it, and when', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const id = await tx.escalation({ studentId: student, schoolId: school });

      await tx.exec("UPDATE escalation_events SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now() WHERE escalation_id = $1", [id, counsellor]);
      await tx.exec("UPDATE escalation_events SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_notes = 'spoke with family' WHERE escalation_id = $1", [id, counsellor]);
      const [e] = await tx.q('SELECT status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_notes FROM escalation_events WHERE escalation_id = $1', [id]);
      expect(e.status).toBe('resolved');
      expect(e.acknowledged_by).toBe(counsellor);
      expect(e.resolved_by).toBe(counsellor);
      expect(e.acknowledged_at).not.toBeNull();
      expect(e.resolved_at).not.toBeNull();
      expect(e.resolution_notes).toBe('spoke with family');
    });
  });

  test('a counsellor note links the counsellor and the student and stores sealed bytes', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const id = await tx.note({ counsellorId: counsellor, studentId: student, sealed: 'opaque-sealed-payload' });
      const [n] = await tx.q('SELECT counsellor_account_id, student_account_id, content_sealed FROM counsellor_notes WHERE note_id = $1', [id]);
      expect(n.counsellor_account_id).toBe(counsellor);
      expect(n.student_account_id).toBe(student);
      expect(Buffer.isBuffer(n.content_sealed)).toBe(true);
    });
  });

  test('a queue signal carries its school and may suggest a protocol', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const protocol = await tx.protocol();
      const id = await tx.queueSignal({ studentId: student, schoolId: school, protocolId: protocol });
      await tx.exec('UPDATE queue_signals SET resolved_at = now() WHERE signal_id = $1', [id]);
      const [q] = await tx.q('SELECT school_id, suggested_protocol_id, resolved_at FROM queue_signals WHERE signal_id = $1', [id]);
      expect(q.school_id).toBe(school);
      expect(q.suggested_protocol_id).toBe(protocol);
      expect(q.resolved_at).not.toBeNull();

      const INSERT = 'INSERT INTO queue_signals (student_account_id, school_id, attention_level, suggested_protocol_id) VALUES ($1, $2, 2, $3)';
      await tx.refused('INSERT INTO queue_signals (student_account_id, attention_level) VALUES ($1, 2)', [student], '23502'); // school_id required
      await tx.refused(INSERT, [student, school, '00000000-0000-0000-0000-000000000000'], '23503'); // protocol must exist
      await tx.exec(INSERT, [student, school, null]); // suggestion is optional
    });
  });

  test('class guidance is unique per school and class, and records how many students it is based on', async () => {
    await withRolledBackTx(async (tx) => {
      const a = await tx.school();
      const b = await tx.school();
      const id = await tx.guidance({ schoolId: a, classLabel: '8-A', coverage: 62.5, cellSize: 18 });
      const [g] = await tx.q('SELECT coverage, cell_size FROM class_guidance_state WHERE state_id = $1', [id]);
      expect(Number(g.coverage)).toBe(62.5);
      expect(g.cell_size).toBe(18);

      await tx.refused("INSERT INTO class_guidance_state (school_id, class_label, pattern_code) VALUES ($1, '8-A', 'P2')", [a], '23505');
      await tx.exec("INSERT INTO class_guidance_state (school_id, class_label, pattern_code) VALUES ($1, '8-A', 'P2')", [b]); // other school: fine
      await tx.exec("INSERT INTO class_guidance_state (school_id, class_label, pattern_code) VALUES ($1, '8-B', 'P2')", [a]); // other class: fine
    });
  });
});
