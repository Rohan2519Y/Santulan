/*
 * US1 - the complete platform database exists and matches docs/SQL-Database-Schema.md.
 * Covers FR-001, FR-003, FR-040, SC-002, SC-003.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { withRolledBackTx, docSqlBlocks } = require('./harness');

const BACKEND_DIR = path.join(__dirname, '..', '..');

const NEW_TABLES = [
  'schools', 'accounts', 'student_profiles', 'staff_profiles', 'parent_profiles', 'school_assignments',
  'capability_grants', 'escalation_events', 'counsellor_notes', 'consent_records', 'scp_consents',
  'scp_sessions', 'scp_assents', 'protocols', 'protocol_orientations', 'protocol_route_events',
  'queue_signals', 'class_guidance_state', 'content_modules', 'module_completions', 'group_sessions',
  'audit_events',
];

/*
 * The capability-assessment module's tables (feature 002). They were removed by migration 006 and
 * restored by 007 because the module still needs them. Not part of the schema doc, so they sit
 * beside the doc's 22 tables. The old `users` table is NOT among them - people are `accounts`.
 */
const ASSESSMENT_TABLES = [
  'response_scales', 'assessment_versions', 'items', 'participant_profiles', 'consents', 'assessment_attempts',
  'responses', 'response_events', 'quality_flags', 'score_results', 'interpretation_rules', 'reports',
  'report_sections', 'content_import_records', 'participation_controls',
];

const ASSESSMENT_ENUMS = [
  'LifecycleStatus', 'ToolBand', 'ItemKeying', 'ItemLayer', 'ItemStatus', 'ParticipationRoute', 'AgeBand',
  'ParticipantContext', 'ConsentType', 'ConsentStatus', 'AttemptStatus', 'ResponseEventType', 'QualityFlagCode',
  'ScoreStatus', 'ReportGenerationStatus', 'ReportSectionType', 'ImportStatus', 'ParticipationAction',
];

const NEW_ENUMS = [
  'account_type_enum', 'account_status_enum', 'role_enum', 'school_assignment_role_enum',
  'resource_enum', 'action_enum', 'scope_type_enum',
];

/** The only deliberate differences from the schema doc's SQL (data-model.md section 2). */
const ALLOWED_EXTRA_COLUMNS = new Set(['queue_signals.school_id', 'accounts.deleted_at']);

/*
 * The same three ER-diagram items, seen as indexes/constraints (PostgreSQL 18 also records
 * NOT NULL as a named constraint, hence the queue_signals_school_id_not_null entry).
 */
const ALLOWED_EXTRA_INDEXES = new Set(['uq_scp_assents_one_per_session']);
const ALLOWED_EXTRA_CONSTRAINTS = new Set(['uq_scp_assents_one_per_session', 'queue_signals_school_id_fkey', 'queue_signals_school_id_not_null']);

const stripSchema = (t) => t.replace(/^(doc_ref|public)\./, '');

async function columnMap(tx, schema) {
  const rows = await tx.q(
    `SELECT cl.relname AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
       FROM pg_attribute a
       JOIN pg_class cl ON cl.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = $1 AND cl.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND cl.relname = ANY($2)`,
    [schema, NEW_TABLES],
  );
  return new Map(rows.map((r) => [`${r.t}.${r.c}`, { type: stripSchema(r.type), nullable: r.nullable }]));
}

async function enumMap(tx, schema) {
  const rows = await tx.q(
    `SELECT t.typname, e.enumlabel
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typname = ANY($2) ORDER BY t.typname, e.enumsortorder`,
    [schema, NEW_ENUMS],
  );
  const out = new Map();
  for (const r of rows) out.set(r.typname, [...(out.get(r.typname) ?? []), r.enumlabel]);
  return out;
}

describe('US1: platform database structure', () => {
  test('matches the schema doc SQL except the 3 documented fixes (SC-002)', async () => {
    await withRolledBackTx(async (tx) => {
      await tx.exec('CREATE SCHEMA doc_ref');
      await tx.exec('SET LOCAL search_path = doc_ref, public');
      for (const block of docSqlBlocks()) await tx.exec(block);

      const docCols = await columnMap(tx, 'doc_ref');
      const dbCols = await columnMap(tx, 'public');
      expect(docCols.size).toBeGreaterThan(0);

      const problems = [];
      for (const [key, doc] of docCols) {
        const db = dbCols.get(key);
        if (!db) problems.push(`missing column ${key}`);
        else if (db.type !== doc.type) problems.push(`${key}: type ${db.type} != doc ${doc.type}`);
        else if (db.nullable !== doc.nullable) problems.push(`${key}: nullable ${db.nullable} != doc ${doc.nullable}`);
      }
      for (const key of dbCols.keys()) {
        if (!docCols.has(key) && !ALLOWED_EXTRA_COLUMNS.has(key)) problems.push(`extra column ${key}`);
      }
      for (const extra of ALLOWED_EXTRA_COLUMNS) {
        if (!dbCols.has(extra)) problems.push(`documented fix column ${extra} is missing`);
      }
      expect(problems).toEqual([]);

      const docEnums = await enumMap(tx, 'doc_ref');
      const dbEnums = await enumMap(tx, 'public');
      expect(Object.fromEntries(dbEnums)).toEqual(Object.fromEntries(docEnums));
    });
  });

  test('has exactly the doc\'s indexes and constraints - nothing added on top (strict conformance)', async () => {
    await withRolledBackTx(async (tx) => {
      await tx.exec('CREATE SCHEMA doc_ref');
      await tx.exec('SET LOCAL search_path = doc_ref, public');
      for (const block of docSqlBlocks()) await tx.exec(block);

      const norm = (s) => s.replace(/\b(doc_ref|public)\./g, '');
      const indexes = async (schema) =>
        new Map(
          (await tx.q('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = ANY($2)', [schema, NEW_TABLES])).map((r) => [r.indexname, norm(r.indexdef)]),
        );
      const constraints = async (schema) =>
        new Map(
          (
            await tx.q(
              `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
                 FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
                WHERE n.nspname = $1 AND cl.relname = ANY($2)`,
              [schema, NEW_TABLES],
            )
          ).map((r) => [r.conname, norm(r.def)]),
        );

      const diff = (kind, docMap, dbMap, allowedExtra) => {
        const problems = [];
        for (const [name, def] of docMap) {
          if (!dbMap.has(name)) problems.push(`${kind} missing: ${name}`);
          else if (dbMap.get(name) !== def) problems.push(`${kind} differs: ${name}\n    db : ${dbMap.get(name)}\n    doc: ${def}`);
        }
        for (const name of dbMap.keys()) if (!docMap.has(name) && !allowedExtra.has(name)) problems.push(`${kind} not in the doc: ${name}`);
        return problems;
      };

      const problems = [
        ...diff('index', await indexes('doc_ref'), await indexes('public'), ALLOWED_EXTRA_INDEXES),
        ...diff('constraint', await constraints('doc_ref'), await constraints('public'), ALLOWED_EXTRA_CONSTRAINTS),
      ];
      expect(problems).toEqual([]);

      // The three ER-diagram items are present.
      const dbIdx = await indexes('public');
      const dbCon = await constraints('public');
      expect(dbIdx.has('uq_scp_assents_one_per_session')).toBe(true);
      expect(dbCon.has('queue_signals_school_id_fkey')).toBe(true);
    });
  });

  test('the database has the doc\'s 22 tables, the assessment module\'s 15, and the migration tracker - nothing else (FR-001)', async () => {
    await withRolledBackTx(async (tx) => {
      const present = (await tx.q("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")).map((r) => r.relname);
      expect(NEW_TABLES).toHaveLength(22);
      expect(ASSESSMENT_TABLES).toHaveLength(15);
      expect([...present].sort()).toEqual([...NEW_TABLES, ...ASSESSMENT_TABLES, '_migrations'].sort());
      // The old `users` table is gone for good: accounts replaced it.
      expect(present).not.toContain('users');
    });
  });

  test('the 7 new enum types exist and resource_enum has no removed-feature resources (FR-015)', async () => {
    await withRolledBackTx(async (tx) => {
      const enums = await enumMap(tx, 'public');
      expect([...enums.keys()].sort()).toEqual([...NEW_ENUMS].sort());
      // ...and the only other enum types are the assessment module's (UserRole went with `users`).
      const allEnumTypes = (await tx.q("SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e'")).map((r) => r.typname);
      expect(allEnumTypes.sort()).toEqual([...NEW_ENUMS, ...ASSESSMENT_ENUMS].sort());
      for (const removed of ['assessment', 'pulse', 'sathi']) expect(enums.get('resource_enum')).not.toContain(removed);
    });
  });

  test('none of the removed features has a table or a retired band value (FR-040)', async () => {
    await withRolledBackTx(async (tx) => {
      const tables = (await tx.q("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")).map((r) => r.relname);
      for (const removed of ['assessments', 'pulse_checkins', 'chat_messages', 'helplines', 'rate_limits']) expect(tables).not.toContain(removed);

      const labels = (await tx.q('SELECT enumlabel FROM pg_enum')).map((r) => r.enumlabel);
      for (const band of ['Thriving', 'Steady', 'Building', 'Struggling', 'In Crisis']) {
        expect(labels.filter((l) => l.includes(band))).toEqual([]);
      }
    });
  });

  test('the documented fix constraints are present', async () => {
    await withRolledBackTx(async (tx) => {
      const assentUnique = await tx.q(
        `SELECT 1 FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = 'scp_assents'::regclass AND i.indisunique AND i.indnatts = 1 AND a.attname = 'session_id'`,
      );
      expect(assentUnique).toHaveLength(1);

      const fk = await tx.q(
        `SELECT 1 FROM pg_constraint
          WHERE conrelid = 'queue_signals'::regclass AND contype = 'f' AND confrelid = 'schools'::regclass`,
      );
      expect(fk).toHaveLength(1);
    });
  });

  test('re-running the migration runner is a no-op (SC-003)', async () => {
    await withRolledBackTx(async (tx) => {
      const applied = new Set((await tx.q('SELECT name FROM _migrations')).map((r) => r.name));
      const onDisk = fs.readdirSync(path.join(BACKEND_DIR, 'migrations')).filter((f) => f.endsWith('.sql'));
      const pending = onDisk.filter((f) => !applied.has(f));
      // Only run the real runner when it is guaranteed to change nothing.
      expect({ pending }).toEqual({ pending: [] });

      const dupes = await tx.q('SELECT name, count(*)::int AS n FROM _migrations GROUP BY name HAVING count(*) > 1');
      expect(dupes).toEqual([]);
    });

    const run = spawnSync('node', ['scripts/migrate.js'], { cwd: BACKEND_DIR, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('No pending migrations');
  });
});
