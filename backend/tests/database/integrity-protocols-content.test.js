/*
 * US6 - protocol library, learning content, group sessions (doc sections 3.6, 3.8).
 */
const { withRolledBackTx } = require('./harness');

describe('US6: protocols, content, group sessions', () => {
  test('a protocol has a unique code, a constrained review status, and defaults', async () => {
    await withRolledBackTx(async (tx) => {
      await tx.exec("INSERT INTO protocols (protocol_code, name, steps) VALUES ('P-1', 'One', ARRAY['a','b'])");
      await tx.refused("INSERT INTO protocols (protocol_code, name, steps) VALUES ('P-1', 'Dup', ARRAY['a'])", [], '23505');
      await tx.refused("INSERT INTO protocols (protocol_code, name) VALUES ('P-2', 'No steps')", [], '23502');
      await tx.refused("INSERT INTO protocols (protocol_code, name, steps, review_status) VALUES ('P-3', 'x', ARRAY['a'], 'archived')", [], '23514');
      for (const status of ['draft', 'approved', 'retired']) {
        await tx.exec('INSERT INTO protocols (protocol_code, name, steps, review_status) VALUES ($1, $1, ARRAY[$2], $3)', [`P-${status}`, 'a', status]);
      }
      const [p] = await tx.q("SELECT review_status, avoid, stop_and_route, version, steps FROM protocols WHERE protocol_code = 'P-1'");
      expect(p).toEqual({ review_status: 'draft', avoid: [], stop_and_route: [], version: 1, steps: ['a', 'b'] });
    });
  });

  test('a staff member can complete a protocol orientation only once', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const staff = await tx.staff({ schoolId: school });
      const protocol = await tx.protocol();
      const other = await tx.protocol();
      await tx.orientation({ accountId: staff, protocolId: protocol });
      await tx.refused('INSERT INTO protocol_orientations (account_id, protocol_id) VALUES ($1, $2)', [staff, protocol], '23505');
      await tx.exec('INSERT INTO protocol_orientations (account_id, protocol_id) VALUES ($1, $2)', [staff, other]); // different protocol: fine
    });
  });

  test('a route event records practitioner, protocol, student, context and time', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const protocol = await tx.protocol();
      const id = await tx.routeEvent({ practitionerId: counsellor, protocolId: protocol, studentId: student, context: 'after class' });
      const [e] = await tx.q('SELECT practitioner_account_id, protocol_id, student_account_id, session_context, created_at FROM protocol_route_events WHERE event_id = $1', [id]);
      expect([e.practitioner_account_id, e.protocol_id, e.student_account_id, e.session_context]).toEqual([counsellor, protocol, student, 'after class']);
      expect(e.created_at).not.toBeNull();
    });
  });

  test('a module targets roles and schools; an empty school list means all schools', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const untargeted = await tx.module({ title: 'Everyone' });
      const targeted = await tx.module({ title: 'One school', targetSchoolIds: [school] });
      const [u] = await tx.q('SELECT target_roles, target_school_ids, is_published, language, order_index FROM content_modules WHERE module_id = $1', [untargeted]);
      expect(u).toEqual({ target_roles: ['student'], target_school_ids: [], is_published: false, language: 'en', order_index: 0 });
      const [t] = await tx.q('SELECT target_school_ids FROM content_modules WHERE module_id = $1', [targeted]);
      expect(t.target_school_ids).toEqual([school]);

      // "Modules visible to this school" = untargeted or targeting it; the empty list is not "none".
      const visible = await tx.q('SELECT title FROM content_modules WHERE cardinality(target_school_ids) = 0 OR $1 = ANY (target_school_ids) ORDER BY title', [school]);
      expect(visible.map((m) => m.title)).toEqual(['Everyone', 'One school']);
    });
  });

  test('a person completes a module only once', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const student = await tx.student({ schoolId: school });
      const module = await tx.module();
      await tx.completion({ accountId: student, moduleId: module });
      await tx.refused('INSERT INTO module_completions (account_id, module_id) VALUES ($1, $2)', [student, module], '23505');
    });
  });

  test('a group session has a counsellor, a school, a date, and an optional module', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const module = await tx.module();
      const id = await tx.groupSession({ counsellorId: counsellor, schoolId: school, moduleId: module, title: 'Class workshop' });
      const [g] = await tx.q('SELECT title, session_date, module_id FROM group_sessions WHERE group_session_id = $1', [id]);
      expect(g.title).toBe('Class workshop');
      expect(g.module_id).toBe(module);
      await tx.exec("INSERT INTO group_sessions (counsellor_account_id, school_id, title, session_date) VALUES ($1, $2, 'No module', '2026-11-01')", [counsellor, school]);

      await tx.refused("INSERT INTO group_sessions (counsellor_account_id, school_id, title) VALUES ($1, $2, 'No date')", [counsellor, school], '23502');
      await tx.refused(
        "INSERT INTO group_sessions (counsellor_account_id, school_id, title, session_date, module_id) VALUES ($1, $2, 'x', '2026-11-01', '00000000-0000-0000-0000-000000000000')",
        [counsellor, school],
        '23503',
      );
    });
  });
});
