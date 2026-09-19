/*
 * US7 - the single consolidated audit trail (doc section 3.10): one table, always an actor
 * and role, school nullable only for platform-wide actions, decrypt events as an ordinary
 * event class.
 */
const { withRolledBackTx } = require('./harness');

const INSERT_AUDIT = `INSERT INTO audit_events (event_class, actor_account_id, actor_role, actor_school_id, target_type, target_id, outcome, detail)
                      VALUES ($1, $2, $3, $4, 'student', 'x', 'success', '{}')`;

describe('US7: audit trail', () => {
  test('a sealed-data-open event is an ordinary audit row with full detail', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const counsellor = await tx.staff({ role: 'counsellor', schoolId: school });
      const id = await tx.audit({
        eventClass: 'class_a_decrypt',
        actorId: counsellor,
        actorRole: 'counsellor',
        schoolId: school,
        targetType: 'counsellor_note',
        targetId: 'note-123',
        outcome: 'success',
        detail: { purpose: 'case review' },
        sourceIp: '10.0.0.5',
        userAgent: 'Mozilla',
      });
      const [a] = await tx.q('SELECT * FROM audit_events WHERE audit_id = $1', [id]);
      expect(a).toMatchObject({
        event_class: 'class_a_decrypt',
        actor_account_id: counsellor,
        actor_role: 'counsellor',
        actor_school_id: school,
        target_type: 'counsellor_note',
        target_id: 'note-123',
        outcome: 'success',
        detail: { purpose: 'case review' },
        source_ip: '10.0.0.5',
        user_agent: 'Mozilla',
      });
      expect(a.occurred_at).not.toBeNull(); // defaults to now
    });
  });

  test('every audit row must name an actor, a role and an action class', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const actor = await tx.staff({ schoolId: school });
      await tx.refused(INSERT_AUDIT, ['x', null, 'counsellor', school], '23502');
      await tx.refused(INSERT_AUDIT, ['x', actor, null, school], '23502');
      await tx.refused(INSERT_AUDIT, [null, actor, 'counsellor', school], '23502');
      await tx.refused(INSERT_AUDIT, ['x', '00000000-0000-0000-0000-000000000000', 'counsellor', school], '23503'); // actor must exist
      await tx.refused(INSERT_AUDIT, ['x', actor, 'counsellor', '00000000-0000-0000-0000-000000000000'], '23503'); // school must exist
    });
  });

  test('a platform-wide action has no school; it is left empty, not invented', async () => {
    await withRolledBackTx(async (tx) => {
      const admin = await tx.account({ role: 'superuser' });
      await tx.exec(INSERT_AUDIT, ['platform_export', admin, 'superuser', null]);
      const [a] = await tx.q("SELECT actor_school_id FROM audit_events WHERE event_class = 'platform_export'");
      expect(a.actor_school_id).toBeNull();
    });
  });

  test('audited actions of several kinds are all complete', async () => {
    await withRolledBackTx(async (tx) => {
      const school = await tx.school();
      const counsellor = await tx.staff({ schoolId: school });
      const admin = await tx.account({ role: 'superuser' });
      await tx.audit({ eventClass: 'class_a_decrypt', actorId: counsellor, schoolId: school });
      await tx.audit({ eventClass: 'capability_grant', actorId: admin, actorRole: 'superuser', schoolId: null });
      await tx.audit({ eventClass: 'cross_school_read', actorId: admin, actorRole: 'superuser', schoolId: null });

      const incomplete = await tx.q(
        `SELECT audit_id FROM audit_events
          WHERE actor_account_id IS NULL OR actor_role IS NULL OR event_class IS NULL OR target_type IS NULL OR outcome IS NULL OR occurred_at IS NULL`,
      );
      expect(incomplete).toEqual([]);
    });
  });
});
