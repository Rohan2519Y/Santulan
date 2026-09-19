/*
 * Harness for the platform-database tests (specs/004-platform-sql-database).
 *
 * Every test runs inside BEGIN ... ROLLBACK on ONE owner connection, so the
 * dev database is never left with test rows and no cleanup code is needed.
 * Fixtures are built as the owner (a superuser bypasses row-level security -
 * correct for seeding); assertions about isolation/privileges then switch to
 * the restricted role with SET LOCAL ROLE, because a superuser would pass
 * every isolation test trivially.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { randomUUID } = require('crypto');
const { Client } = require('pg');

const DOC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'SQL-Database-Schema.md');
const ALLOWED_ROLES = new Set(['app_runtime', 'app_readonly']);
const STAFF_ROLES = new Set(['counsellor', 'principal', 'teacher', 'support']);

/** Every ```sql fenced block of the schema doc, in document order. */
function docSqlBlocks() {
  const md = fs.readFileSync(DOC_PATH, 'utf8');
  return [...md.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
}

const uniq = () => randomUUID().slice(0, 8);

function buildTx(client) {
  const tx = {
    client,
    /** Runs a statement and returns the full pg result (rowCount, rows, ...). */
    exec: (sql, params) => client.query(sql, params),
    /** Runs a statement and returns just the rows. */
    q: async (sql, params) => (await client.query(sql, params)).rows,

    async asRole(name) {
      if (!ALLOWED_ROLES.has(name)) throw new Error(`asRole: unsupported role ${name}`);
      await client.query(`SET LOCAL ROLE ${name}`);
    },
    asOwner: () => client.query('RESET ROLE'),

    /** Acts for one school (never sets the platform bypass). */
    async scope(schoolId) {
      await client.query("SELECT set_config('app.bypass_rls', '', true)");
      await client.query("SELECT set_config('app.current_school_id', $1, true)", [schoolId ?? '']);
    },
    /** Platform scope: all schools visible. */
    async platform() {
      await client.query("SELECT set_config('app.current_school_id', '', true)");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    },
    /** No school and no bypass - the fail-closed state. */
    async clearScope() {
      await client.query("SELECT set_config('app.current_school_id', '', true)");
      await client.query("SELECT set_config('app.bypass_rls', '', true)");
    },

    /**
     * Asserts the statement is refused with the given SQLSTATE. A failed
     * statement aborts a PostgreSQL transaction, so it runs inside a
     * savepoint - which is what lets one test assert several refusals.
     */
    async refused(sql, params, sqlstate) {
      await client.query('SAVEPOINT refused_sp');
      let failure = null;
      try {
        await client.query(sql, params);
      } catch (err) {
        failure = err;
      }
      if (failure) await client.query('ROLLBACK TO SAVEPOINT refused_sp');
      await client.query('RELEASE SAVEPOINT refused_sp');
      if (!failure) throw new Error(`expected SQLSTATE ${sqlstate} but the statement succeeded: ${sql}`);
      if (failure.code !== sqlstate) {
        throw new Error(`expected SQLSTATE ${sqlstate}, got ${failure.code}: ${failure.message} -- ${sql}`);
      }
      return failure;
    },
  };

  /* ---- fixture builders (run as owner; leave the connection as owner) ---- */
  const insert = async (sql, params) => {
    await tx.asOwner();
    return (await client.query(sql, params)).rows[0];
  };

  tx.school = async (o = {}) =>
    (await insert('INSERT INTO schools (name, status) VALUES ($1, $2) RETURNING school_id', [o.name ?? `School ${uniq()}`, o.status ?? 'pilot'])).school_id;

  tx.account = async (o = {}) => {
    const role = o.accountType === 'platform_staff' ? 'support' : o.role ?? 'student';
    const accountType = o.accountType ?? (role === 'superuser' ? 'superuser' : 'school_user');
    const schoolId = accountType === 'school_user' ? o.schoolId ?? null : null;
    const passwordHash = 'passwordHash' in o ? o.passwordHash : 'x';
    const u = uniq();
    return (
      await insert(
        `INSERT INTO accounts (account_type, role, status, school_id, email, mobile, name, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING account_id`,
        [accountType, role, o.status ?? 'active', schoolId, o.email ?? `${role}-${u}@test.local`, o.mobile ?? `9${Math.floor(Math.random() * 1e9)}${u}`, o.name ?? `${role} ${u}`, passwordHash],
      )
    ).account_id;
  };

  tx.student = async (o = {}) => {
    const accountId = await tx.account({ ...o, role: 'student' });
    await insert('INSERT INTO student_profiles (account_id, login_id, class_name, section) VALUES ($1, $2, $3, $4) RETURNING account_id', [
      accountId,
      o.loginId === undefined ? `login-${uniq()}` : o.loginId,
      o.className ?? '8',
      o.section ?? 'A',
    ]);
    return accountId;
  };

  tx.parent = async (o = {}) => {
    const accountId = await tx.account({ ...o, role: 'parent' });
    await insert('INSERT INTO parent_profiles (account_id, relation_type, linked_student_account_ids) VALUES ($1, $2, $3) RETURNING account_id', [
      accountId,
      o.relationType ?? null,
      o.linked ?? [],
    ]);
    return accountId;
  };

  tx.staff = async (o = {}) => {
    const role = o.role ?? 'counsellor';
    if (!STAFF_ROLES.has(role)) throw new Error(`staff: ${role} is not a staff role`);
    const accountId = await tx.account({ ...o, role });
    await insert('INSERT INTO staff_profiles (account_id, work_email, designation) VALUES ($1, $2, $3) RETURNING account_id', [
      accountId,
      o.workEmail === undefined ? `work-${uniq()}@test.local` : o.workEmail,
      o.designation ?? role,
    ]);
    return accountId;
  };

  tx.assignment = async (o) =>
    (
      await insert(
        `INSERT INTO school_assignments (account_id, school_id, assignment_role, class_label, assigned_by, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING assignment_id`,
        [o.accountId, o.schoolId, o.role ?? 'counsellor', o.classLabel ?? null, o.assignedBy ?? null, o.revokedAt ?? null],
      )
    ).assignment_id;

  tx.grant = async (o) =>
    (
      await insert(
        `INSERT INTO capability_grants (account_id, resource, action, fields, scope_type, scope_id, granted_by, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING grant_id`,
        [o.accountId, o.resource ?? 'student', o.action ?? 'read', o.fields ?? null, o.scopeType ?? 'school', o.scopeId ?? 'x', o.grantedBy, o.expiresAt ?? null, o.revokedAt ?? null],
      )
    ).grant_id;

  tx.escalation = async (o) =>
    (
      await insert(
        `INSERT INTO escalation_events (student_account_id, school_id, user_type, escalation_level, trigger_reason, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING escalation_id`,
        [o.studentId, o.schoolId, o.userType ?? 'student', o.level ?? 3, o.reason ?? 'test reason', o.status ?? 'open'],
      )
    ).escalation_id;

  tx.note = async (o) =>
    (
      await insert('INSERT INTO counsellor_notes (counsellor_account_id, student_account_id, content_sealed) VALUES ($1, $2, $3) RETURNING note_id', [
        o.counsellorId,
        o.studentId,
        Buffer.from(o.sealed ?? 'sealed-bytes'),
      ])
    ).note_id;

  tx.consentRecord = async (o) =>
    (
      await insert('INSERT INTO consent_records (student_account_id, school_id, status, method) VALUES ($1, $2, $3, $4) RETURNING consent_id', [
        o.studentId,
        o.schoolId,
        o.status ?? 'granted',
        o.method ?? 'paper',
      ])
    ).consent_id;

  tx.scpConsent = async (o) =>
    (
      await insert(
        `INSERT INTO scp_consents (student_account_id, parent_account_id, school_id, status, academic_year, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING consent_id`,
        [o.studentId, o.parentId ?? null, o.schoolId, o.status ?? 'granted', o.academicYear ?? '2026-27', o.validFrom ?? '2026-06-01', o.validUntil ?? '2027-05-31'],
      )
    ).consent_id;

  tx.scpSession = async (o) =>
    (
      await insert(
        `INSERT INTO scp_sessions (student_account_id, checkpoint, state, completed_at, item_responses_sealed, domain_scores)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING session_id`,
        [
          o.studentId,
          o.checkpoint ?? 'CP1',
          o.state ?? 'in_progress',
          o.completedAt ?? null,
          o.responses ? JSON.stringify(o.responses) : null,
          o.scores ? JSON.stringify(o.scores) : null,
        ],
      )
    ).session_id;

  tx.assent = async (o) =>
    (
      await insert('INSERT INTO scp_assents (student_account_id, session_id, assented, assented_at) VALUES ($1, $2, $3, now()) RETURNING assent_id', [
        o.studentId,
        o.sessionId,
        o.assented ?? true,
      ])
    ).assent_id;

  tx.protocol = async (o = {}) =>
    (
      await insert('INSERT INTO protocols (protocol_code, name, steps, review_status) VALUES ($1, $2, $3, $4) RETURNING protocol_id', [
        o.code ?? `P-${uniq()}`,
        o.name ?? 'Test protocol',
        o.steps ?? ['step one'],
        o.reviewStatus ?? 'approved',
      ])
    ).protocol_id;

  tx.orientation = async (o) =>
    (await insert('INSERT INTO protocol_orientations (account_id, protocol_id) VALUES ($1, $2) RETURNING orientation_id', [o.accountId, o.protocolId])).orientation_id;

  tx.routeEvent = async (o) =>
    (
      await insert(
        'INSERT INTO protocol_route_events (practitioner_account_id, protocol_id, student_account_id, session_context) VALUES ($1, $2, $3, $4) RETURNING event_id',
        [o.practitionerId, o.protocolId, o.studentId, o.context ?? 'test'],
      )
    ).event_id;

  tx.queueSignal = async (o) =>
    (
      await insert(
        'INSERT INTO queue_signals (student_account_id, school_id, attention_level, reason, suggested_protocol_id) VALUES ($1, $2, $3, $4, $5) RETURNING signal_id',
        [o.studentId, o.schoolId, o.level ?? 2, o.reason ?? 'test', o.protocolId ?? null],
      )
    ).signal_id;

  tx.guidance = async (o) =>
    (
      await insert('INSERT INTO class_guidance_state (school_id, class_label, pattern_code, coverage, cell_size) VALUES ($1, $2, $3, $4, $5) RETURNING state_id', [
        o.schoolId,
        o.classLabel ?? '8-A',
        o.patternCode ?? 'P1',
        o.coverage ?? 40,
        o.cellSize ?? 25,
      ])
    ).state_id;

  tx.module = async (o = {}) =>
    (
      await insert('INSERT INTO content_modules (title, target_school_ids) VALUES ($1, $2) RETURNING module_id', [o.title ?? `Module ${uniq()}`, o.targetSchoolIds ?? []])
    ).module_id;

  tx.completion = async (o) =>
    (await insert('INSERT INTO module_completions (account_id, module_id) VALUES ($1, $2) RETURNING completion_id', [o.accountId, o.moduleId])).completion_id;

  tx.groupSession = async (o) =>
    (
      await insert(
        'INSERT INTO group_sessions (counsellor_account_id, school_id, title, session_date, module_id) VALUES ($1, $2, $3, $4, $5) RETURNING group_session_id',
        [o.counsellorId, o.schoolId, o.title ?? 'Workshop', o.date ?? '2026-10-01', o.moduleId ?? null],
      )
    ).group_session_id;

  tx.audit = async (o) =>
    (
      await insert(
        `INSERT INTO audit_events (event_class, actor_account_id, actor_role, actor_school_id, target_type, target_id, outcome, detail, source_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING audit_id`,
        [
          o.eventClass ?? 'test_event',
          o.actorId,
          o.actorRole ?? 'counsellor',
          o.schoolId ?? null,
          o.targetType ?? 'student',
          o.targetId ?? 'x',
          o.outcome ?? 'success',
          JSON.stringify(o.detail ?? {}),
          o.sourceIp ?? '127.0.0.1',
          o.userAgent ?? 'jest',
        ],
      )
    ).audit_id;

  return tx;
}

/**
 * Opens one owner connection, BEGIN, runs fn(tx), and ALWAYS rolls back and
 * closes - the database is never left with test rows.
 */
async function withRolledBackTx(fn) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    return await fn(buildTx(client));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

module.exports = { withRolledBackTx, docSqlBlocks, uniq };
