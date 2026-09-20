/*
 * Canonical schema tests — specs/005-v3-1-canonical-alignment (Phase 2 foundation, US1 catalog, US2/US3 DB rules,
 * US5 delivery rules, RLS). Titles start with the BUILD matrix id where one exists.
 */
const { withTx } = require('../harness');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const EA = 'santulan-emergingadult-pilot-v3.1';

const TABLES = [
  'institutions', 'cohorts', 'participants', 'participant_cohort_history', 'consents', 'response_scales',
  'assessment_versions', 'items', 'assessment_attempts', 'responses', 'response_events', 'quality_flags',
  'score_results', 'interpretation_rules', 'development_actions', 'reflection_prompts', 'reports', 'report_sections',
  'growth_plans', 'growth_priorities', 'growth_goals', 'growth_actions', 'growth_reviews', 'pathway_decisions',
  'pathway_reviews', 'research_exports', 'admin_users', 'audit_logs',
];
const INDEXES = [
  'idx_institutions_parent', 'idx_cohorts_institution_status', 'uq_participants_auth_subject', 'idx_participants_institution',
  'idx_participants_cohort', 'idx_participant_history_participant', 'idx_consents_participant_status',
  'uq_verified_consent_per_protocol', 'idx_items_version_domain_order', 'idx_items_version_subdomain', 'idx_items_code',
  'idx_attempts_participant_status', 'uq_one_nonterminal_attempt_per_participant', 'uq_response_version', 'uq_current_response',
  'idx_responses_attempt_current', 'idx_response_events_attempt_time', 'idx_quality_flags_attempt', 'idx_scores_attempt',
  'idx_reports_participant', 'idx_report_sections_report', 'idx_growth_plans_participant', 'idx_growth_priorities_plan',
  'idx_growth_reviews_goal', 'idx_pathway_decisions_participant', 'idx_pathway_reviews_decision',
  'idx_research_exports_requested_by', 'idx_audit_logs_target', 'idx_audit_logs_actor',
  'uq_participant_institution_external_id', // BUILD 03 §11 (migration 019)
  'uq_consent_active_type_protocol', // BUILD 04 §9 (migration 020)
  'uq_submit_idempotency', // BUILD 05 §11 (migration 021)
  'uq_quality_flag_logical', // BUILD 06 §13 (migration 023; a BUILD 06 addition)
];

describe('structure (SC-001, T03-028, B05-041, SEC-12)', () => {
  test('SC-001 exactly the 28 canonical base tables exist', () => withTx(async (tx) => {
    const rows = await tx.q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE'`);
    expect(rows.map((r) => r.table_name).sort()).toEqual([...TABLES].sort());
  }));

  test('the 29 indexes of BUILD 01 §8 (+1 from BUILD 03) exist and no extra non-key index was added', () => withTx(async (tx) => {
    const rows = await tx.q(`SELECT indexname FROM pg_indexes WHERE schemaname = 'santulan' AND indexname NOT LIKE '%\\_pkey' ESCAPE '\\' AND indexname NOT LIKE '%\\_key' ESCAPE '\\'`);
    expect(rows.map((r) => r.indexname).sort()).toEqual([...INDEXES].sort());
  }));

  test('RLS is enabled and forced on every canonical table', () => withTx(async (tx) => {
    const rows = await tx.q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'santulan' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(rows).toEqual([]);
  }));

  test('SEC-12 runtime role has no BYPASSRLS, is not superuser and owns no santulan table; worker exists', () => withTx(async (tx) => {
    const r = await tx.one(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_runtime'`);
    expect(r).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await tx.q(`SELECT tablename FROM pg_tables WHERE schemaname = 'santulan' AND tableowner = 'app_runtime'`);
    expect(owned).toEqual([]);
    const w = await tx.one(`SELECT rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'santulan_worker'`);
    expect(w).toEqual({ rolbypassrls: false, rolcanlogin: false });
  }));

  test('legacy BYPASSRLS role app_platform (if present) has no access to santulan', () => withTx(async (tx) => {
    const r = await tx.one(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') AS e`);
    if (!r.e) return;
    const g = await tx.one(`SELECT has_schema_privilege('app_platform', 'santulan', 'USAGE') AS u`);
    expect(g.u).toBe(false);
  }));

  test('PUBLIC has no EXECUTE on any santulan function', () => withTx(async (tx) => {
    const rows = await tx.q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'santulan' AND has_function_privilege('public', p.oid, 'EXECUTE')`);
    expect(rows).toEqual([]);
  }));
});

describe('functions and context (age routing, SEC-10/11)', () => {
  test('T03-001…006 age routing boundaries; age 18 is EMERGING_ADULT only', () => withTx(async (tx) => {
    const t = async (age) => (await tx.one('SELECT santulan.resolve_assessment_track($1::smallint) AS t, santulan.resolve_developmental_band($1::smallint) AS b', [age]));
    expect(await t(12)).toEqual({ t: null, b: null });
    expect(await t(13)).toEqual({ t: 'ADOLESCENT', b: 'D1' });
    expect(await t(15)).toEqual({ t: 'ADOLESCENT', b: 'D1' });
    expect(await t(16)).toEqual({ t: 'ADOLESCENT', b: 'D2' });
    expect(await t(17)).toEqual({ t: 'ADOLESCENT', b: 'D2' });
    expect(await t(18)).toEqual({ t: 'EMERGING_ADULT', b: 'D3' });
    expect(await t(20)).toEqual({ t: 'EMERGING_ADULT', b: 'D3' });
    expect(await t(21)).toEqual({ t: 'EMERGING_ADULT', b: 'D4' });
    expect(await t(25)).toEqual({ t: 'EMERGING_ADULT', b: 'D4' });
    expect(await t(26)).toEqual({ t: null, b: null });
  }));

  test('72 canonical subdomains; domain membership incl. C7A/B/C; C4.4 belongs to C4 not C5', () => withTx(async (tx) => {
    const n = await tx.one(`SELECT count(*)::int AS n FROM (SELECT DISTINCT subdomain_code FROM santulan.reflection_prompts) s
                              WHERE santulan.valid_subdomain_code(subdomain_code)`);
    expect(n.n).toBe(72);
    const f = async (d, s) => (await tx.one('SELECT santulan.subdomain_belongs_to_domain($1, $2) AS b', [d, s])).b;
    expect(await f('C4', 'C4.4')).toBe(true);
    expect(await f('C5', 'C4.4')).toBe(false);
    expect(await f('C7', 'C7B.3')).toBe(true);
    expect(await f('C7', 'C6.1')).toBe(false);
    expect((await tx.one(`SELECT santulan.valid_subdomain_code('C4.6') AS v`)).v).toBe(false);
  }));

  test('SEC-10 no context returns no participant rows; SEC-11 SET LOCAL context does not survive the transaction', () => withTx(async (tx) => {
    const inst = await tx.institution();
    await tx.participant({ age: 15 });
    await tx.asRole('app_runtime');
    await tx.ctx({});
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.participants')).n).toBe(0);
    expect((await tx.one('SELECT santulan.ctx_actor_scope() AS s')).s).toBeNull();
    await tx.ctx({ scope: 'SUPER_ADMIN' });
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.participants WHERE santulan_id LIKE 'STN-TEST%'`)).n).toBe(1);
    expect(inst.institution_id).toBeTruthy();
  }));
});

describe('catalog and release defaults (US1, T-B02-001…008, AT-B00-06/07/08, FR-007)', () => {
  test('175 + 171 items, 72 subdomains each, 124 shared codes, no legacy construct codes', () => withTx(async (tx) => {
    const per = await tx.q(`SELECT v.version_label, count(*)::int AS items, count(DISTINCT i.subdomain_code)::int AS subs,
                                   min(i.display_order) AS lo, max(i.display_order) AS hi
                              FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) GROUP BY 1 ORDER BY 1`);
    expect(per).toEqual([
      { version_label: ADOL, items: 175, subs: 72, lo: 1, hi: 175 },
      { version_label: EA, items: 171, subs: 72, lo: 1, hi: 171 },
    ]);
    const shared = await tx.one(`SELECT count(*)::int AS n FROM santulan.items a JOIN santulan.items b
                                    ON a.item_code = b.item_code AND a.assessment_version_id < b.assessment_version_id
                                   WHERE a.item_text = b.item_text AND a.subdomain_code = b.subdomain_code`);
    expect(shared.n).toBe(124);
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.items WHERE subdomain_code = 'C4.6'`)).n).toBe(0);
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.items WHERE domain_code = 'C5' AND subdomain_code NOT LIKE 'C5.%'`)).n).toBe(0);
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.items WHERE layer <> 'CORE' OR keying <> 'POSITIVE' OR status <> 'ACTIVE'`)).n).toBe(0);
  }));

  test('domain counts and age-band / context splits match the frozen catalog', () => withTx(async (tx) => {
    const dom = async (label) => Object.fromEntries((await tx.q(`SELECT domain_code, count(*)::int AS n FROM santulan.items i
        JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1 GROUP BY 1`, [label])).map((r) => [r.domain_code, r.n]));
    expect(await dom(ADOL)).toEqual({ C1: 24, C2: 24, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 });
    expect(await dom(EA)).toEqual({ C1: 23, C2: 21, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 });
    const split = async (label, col) => Object.fromEntries((await tx.q(`SELECT ${col} AS k, count(*)::int AS n FROM santulan.items i
        JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1 GROUP BY 1`, [label])).map((r) => [r.k, r.n]));
    expect(await split(ADOL, 'context')).toEqual({ General: 123, School: 50, Digital: 2 });
    expect(await split(EA, 'context')).toEqual({ General: 123, 'College/Work': 46, Digital: 2 });
    expect(await split(ADOL, 'age_band')).toEqual({ '13–25': 124, '13–17': 51 });
    expect(await split(EA, 'age_band')).toEqual({ '13–25': 124, '18–25': 47 });
  }));

  test('FR-007 fail-closed seed: DRAFT/CLOSED, scale DRAFT, 216 inactive actions, 72 DRAFT prompts, 0 rules', () => withTx(async (tx) => {
    const v = await tx.q('SELECT version_label, status, participation_state, participant_min_age, participant_max_age FROM santulan.assessment_versions ORDER BY 1');
    expect(v).toEqual([
      { version_label: ADOL, status: 'DRAFT', participation_state: 'CLOSED', participant_min_age: 13, participant_max_age: 17 },
      { version_label: EA, status: 'DRAFT', participation_state: 'CLOSED', participant_min_age: 18, participant_max_age: 25 },
    ]);
    expect((await tx.one(`SELECT status, version FROM santulan.response_scales`))).toEqual({ status: 'DRAFT', version: 'santulan-capability-frequency-5pt-candidate-v3.1' });
    expect((await tx.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE active)::int AS a FROM santulan.development_actions`))).toEqual({ n: 216, a: 0 });
    expect((await tx.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'DRAFT')::int AS d FROM santulan.reflection_prompts`))).toEqual({ n: 72, d: 72 });
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.interpretation_rules')).n).toBe(0);
    const ids = (await tx.q('SELECT assessment_version_id FROM santulan.assessment_versions ORDER BY version_label')).map((r) => r.assessment_version_id);
    expect(ids).toEqual(['d6c8be95-0290-5aad-8ab8-f20e3a786e13', 'f88a7bf0-78f2-52c7-ab4c-1b4ea36fcd17']);
  }));

  test('a version cannot be frozen before its scale, nor opened while DRAFT (fail closed)', () => withTx(async (tx) => {
    await tx.refused(`UPDATE santulan.assessment_versions SET status = 'FROZEN', frozen_at = now() WHERE version_label = '${ADOL}'`, [], 'SN003');
    await tx.refused(`UPDATE santulan.assessment_versions SET participation_state = 'OPEN' WHERE version_label = '${ADOL}'`, [], 'SN009');
  }));

  test('T-B02-011 / B05-034 frozen content is immutable; only participation_state may change', () => withTx(async (tx) => {
    const v = await tx.openVersion(ADOL);
    await tx.refused(`UPDATE santulan.items SET item_text = 'x' WHERE assessment_version_id = $1`, [v.assessment_version_id], 'SN004');
    await tx.refused(`UPDATE santulan.assessment_versions SET content_hash = 'x' WHERE version_label = '${ADOL}'`, [], 'SN004');
    await tx.refused(`UPDATE santulan.response_scales SET anchor_labels = '{}'::jsonb`, [], 'SN004');
    await tx.exec(`UPDATE santulan.assessment_versions SET participation_state = 'PAUSED' WHERE version_label = '${ADOL}'`);
  }));
});

describe('identity and consent rules (US2, US3: T03-007…013, T04-005…026)', () => {
  test('participant scope constraints and generated columns', () => withTx(async (tx) => {
    const i1 = await tx.institution();
    const i2 = await tx.institution();
    const c1 = await tx.cohort(i1.institution_id);
    const minor = await tx.participant({ age: 13 });
    expect(minor).toMatchObject({ assessment_track: 'ADOLESCENT', is_minor: true, developmental_band: 'D1' });
    const adult18 = await tx.participant({ age: 18 });
    expect(adult18).toMatchObject({ assessment_track: 'EMERGING_ADULT', is_minor: false, developmental_band: 'D3' });
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration) VALUES ('X1','OPEN',12)`, [], '23514');
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration) VALUES ('X2','OPEN',26)`, [], '23514');
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration) VALUES ('X3','INSTITUTIONAL',15)`, [], '23514');
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, institution_id, cohort_id, age_years_at_registration)
                      VALUES ('X4','INSTITUTIONAL',$1,$2,15)`, [i2.institution_id, c1.cohort_id], '23514'); // cohort of another institution
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration, auth_provider) VALUES ('X5','OPEN',15,'p')`, [], '23514');
    await tx.exec(`INSERT INTO santulan.participants (santulan_id, participation_route, institution_id, cohort_id, age_years_at_registration, external_student_id)
                   VALUES ('X6','INSTITUTIONAL',$1,$2,15,'R1')`, [i1.institution_id, c1.cohort_id]);
  }));

  test('T03-011 the same auth identity cannot bind two participants', () => withTx(async (tx) => {
    await tx.exec(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration, auth_provider, auth_provider_subject_id) VALUES ('A1','OPEN',15,'prov','sub1')`);
    await tx.refused(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration, auth_provider, auth_provider_subject_id) VALUES ('A2','OPEN',15,'prov','sub1')`, [], '23505');
  }));

  test('T04-005…010 consent type / age / giver compatibility', () => withTx(async (tx) => {
    const minor = await tx.participant({ age: 14 });
    const adult = await tx.participant({ age: 19 });
    const ins = (p, t, g) => tx.refused(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ('${p}','${t}','${g}','v1')`, [], '23514');
    await ins(minor.participant_id, 'ADULT_SELF_CONSENT', 'SELF');
    await ins(adult.participant_id, 'STUDENT_ASSENT', 'SELF');
    await ins(adult.participant_id, 'PARENT_GUARDIAN_CONSENT', 'PARENT');
    await ins(minor.participant_id, 'STUDENT_ASSENT', 'PARENT');
    await ins(minor.participant_id, 'PARENT_GUARDIAN_CONSENT', 'SELF');
  }));

  test('T04-011…017 consent state machine: no skip, WITHDRAWN is terminal, timestamps immutable', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 20 });
    const c = await tx.one(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version)
                            VALUES ($1,'ADULT_SELF_CONSENT','SELF','v1') RETURNING consent_id`, [p.participant_id]);
    await tx.refused(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version, status, granted_at, verified_at, verification_method)
                      VALUES ($1,'ADULT_SELF_CONSENT','SELF','v2','VERIFIED', now(), now(), 'M')`, [p.participant_id], 'SN003');   // must be created PENDING
    await tx.refused(`UPDATE santulan.consents SET status = 'VERIFIED', verified_at = now(), granted_at = now(), verification_method = 'M' WHERE consent_id = $1`, [c.consent_id], 'SN003'); // PENDING -> VERIFIED
    await tx.exec(`UPDATE santulan.consents SET status = 'GRANTED', granted_at = now() WHERE consent_id = $1`, [c.consent_id]);
    await tx.refused(`UPDATE santulan.consents SET status = 'VERIFIED' WHERE consent_id = $1`, [c.consent_id], '23514');           // VERIFIED without verified_at
    await tx.exec(`UPDATE santulan.consents SET status = 'VERIFIED', verified_at = now(), verification_method = 'M' WHERE consent_id = $1`, [c.consent_id]);
    await tx.refused(`UPDATE santulan.consents SET verified_at = now() + interval '1 day' WHERE consent_id = $1`, [c.consent_id], 'SN004');
    await tx.exec(`UPDATE santulan.consents SET status = 'WITHDRAWN', withdrawn_at = now() WHERE consent_id = $1`, [c.consent_id]);
    await tx.refused(`UPDATE santulan.consents SET status = 'GRANTED' WHERE consent_id = $1`, [c.consent_id], 'SN003');            // terminal
    await tx.refused('DELETE FROM santulan.consents WHERE consent_id = $1', [c.consent_id], 'SN004');
  }));

  test('T04-023…026 BUILD 04 controls: nonblank method/protocol, one active record per type+protocol, deterministic gate', () => withTx(async (tx) => {
    const minor = await tx.participant({ age: 15 });
    const insert = (type, giver, proto) => tx.one(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,$2,$3,$4) RETURNING consent_id`, [minor.participant_id, type, giver, proto]);
    await tx.refused(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,'STUDENT_ASSENT','SELF','   ')`, [minor.participant_id], '23514');
    const assent = await insert('STUDENT_ASSENT', 'SELF', 'v1');
    await tx.refused(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,'STUDENT_ASSENT','SELF','v1')`, [minor.participant_id], '23505'); // one active
    await tx.exec(`UPDATE santulan.consents SET status='GRANTED', granted_at=now() WHERE consent_id=$1`, [assent.consent_id]);
    await tx.refused(`UPDATE santulan.consents SET status='VERIFIED', verified_at=now(), verification_method='   ' WHERE consent_id=$1`, [assent.consent_id], '23514');
    await tx.exec(`UPDATE santulan.consents SET status='WITHDRAWN', withdrawn_at=now() WHERE consent_id=$1`, [assent.consent_id]);
    await insert('STUDENT_ASSENT', 'SELF', 'v1');                                    // re-consent is a new row once the old one is withdrawn

    const g = await tx.one('SELECT * FROM santulan.build04_consent_gate($1)', [minor.participant_id]);
    expect(g).toMatchObject({ is_minor: true, gate_open: false, required_types: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], missing_types: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
    expect(await tx.q('SELECT * FROM santulan.build04_consent_gate($1)', ['00000000-0000-4000-8000-000000000000'])).toEqual([]);
    const adult = await tx.participant({ age: 30 - 8 });
    expect(await tx.one('SELECT * FROM santulan.build04_consent_gate($1)', [adult.participant_id])).toMatchObject({ is_minor: false, required_types: ['ADULT_SELF_CONSENT'] });
  }));

  test('T04-018…022 consent gate: minor needs BOTH verified, adult one; withdrawal closes it', () => withTx(async (tx) => {
    const minor = await tx.participant({ age: 16 });
    const gate = async (id) => (await tx.one('SELECT santulan.participant_has_required_consent($1) AS g', [id])).g;
    expect(await gate(minor.participant_id)).toBe(false);
    const parent = await tx.one(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,'PARENT_GUARDIAN_CONSENT','GUARDIAN','v1') RETURNING consent_id`, [minor.participant_id]);
    await tx.exec(`UPDATE santulan.consents SET status='GRANTED', granted_at=now() WHERE consent_id=$1`, [parent.consent_id]);
    await tx.exec(`UPDATE santulan.consents SET status='VERIFIED', verified_at=now(), verification_method='M' WHERE consent_id=$1`, [parent.consent_id]);
    expect(await gate(minor.participant_id)).toBe(false);                    // assent missing
    const assent = await tx.one(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,'STUDENT_ASSENT','SELF','v1') RETURNING consent_id`, [minor.participant_id]);
    await tx.exec(`UPDATE santulan.consents SET status='GRANTED', granted_at=now() WHERE consent_id=$1`, [assent.consent_id]);
    expect(await gate(minor.participant_id)).toBe(false);                    // GRANTED is not VERIFIED
    await tx.exec(`UPDATE santulan.consents SET status='VERIFIED', verified_at=now(), verification_method='M' WHERE consent_id=$1`, [assent.consent_id]);
    expect(await gate(minor.participant_id)).toBe(true);
    await tx.exec(`UPDATE santulan.consents SET status='WITHDRAWN', withdrawn_at=now() WHERE consent_id=$1`, [assent.consent_id]);
    expect(await gate(minor.participant_id)).toBe(false);
  }));
});

describe('attempt gate and delivery (US5: T03-017…020, T04-029/030, B05-001…035)', () => {
  test('attempt is refused without consent, on a DRAFT/CLOSED version, and for the wrong age range', () => withTx(async (tx) => {
    const minor = await tx.participant({ age: 15 });
    const adult = await tx.participant({ age: 18 });
    const vid = (await tx.one('SELECT assessment_version_id FROM santulan.assessment_versions WHERE version_label = $1', [ADOL])).assessment_version_id;
    const eaId = (await tx.one('SELECT assessment_version_id FROM santulan.assessment_versions WHERE version_label = $1', [EA])).assessment_version_id;
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,15)`, [minor.participant_id, vid], 'SN001'); // no consent
    await tx.verifyConsents(minor.participant_id, true);
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,15)`, [minor.participant_id, vid], 'SN009'); // DRAFT/CLOSED (T04-030)
    await tx.openVersion(ADOL);
    await tx.verifyConsents(adult.participant_id, false);
    await tx.openVersion(EA);
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,18)`, [adult.participant_id, vid], '23514'); // T03-019 age 18 vs adolescent
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,17)`, [minor.participant_id, eaId], '23514'); // T03-020 age 17 vs emerging adult
    const ok = await tx.attempt(minor.participant_id, vid, 15);
    expect(ok).toMatchObject({ status: 'CREATED', session_count: 0 });
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,15)`, [minor.participant_id, vid], '23505'); // B05-001 one nonterminal attempt
  }));

  test('B05-002…024 sessions, response versioning, idempotency, scale, immutability and submit', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 15 });
    await tx.verifyConsents(p.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p.participant_id, v.assessment_version_id, 15);
    const item1 = await tx.item(ADOL, 1);
    const item2 = await tx.item(ADOL, 2);
    const save = (item, value, key, time = 1200, order = 1) =>
      tx.one('SELECT santulan.save_response($1,$2,$3,$4,$5,$6) AS id', [a.attempt_id, item.item_id, value, time, order, key]);

    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item1.item_id, '3', 'key-before-start-0001'], 'SN008'); // not started
    expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(1);
    expect((await tx.one('SELECT status, session_count FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.attempt_id]))).toEqual({ status: 'IN_PROGRESS', session_count: 1 });
    // B05-004 reconnect while IN_PROGRESS
    expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(1);
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SESSION_START'`, [a.attempt_id])).n).toBe(1);

    // first answer, retry with the same key + payload, then a revision
    const r1 = (await save(item1, '3', 'key-item1-v1-000001')).id;
    expect((await save(item1, '3', 'key-item1-v1-000001')).id).toBe(r1);                                   // B05-007 safe retry
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1200,1,$4)', [a.attempt_id, item1.item_id, '4', 'key-item1-v1-000001'], 'SN006'); // B05-008 same key, other payload
    const r2 = (await save(item1, '5', 'key-item1-v2-000002')).id;                                          // B05-009 revision
    const chain = await tx.q('SELECT response_version, is_current, supersedes_response_id, response_value FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2 ORDER BY response_version', [a.attempt_id, item1.item_id]);
    expect(chain).toEqual([
      { response_version: 1, is_current: false, supersedes_response_id: null, response_value: '3' },
      { response_version: 2, is_current: true, supersedes_response_id: r1, response_value: '5' },
    ]);
    expect(r2).not.toBe(r1);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2 AND is_current', [a.attempt_id, item1.item_id])).n).toBe(1); // RC-02

    // scale / version / immutability guards
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item2.item_id, '6', 'key-scale-high-00003'], 'SN007');
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item2.item_id, '0', 'key-scale-low-000004'], 'SN007');
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item2.item_id, 'abc', 'key-scale-text-00005'], 'SN007');
    const other = await tx.item(EA, 1);                                                                     // AT-14 / Q06 cross-version item
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, other.item_id, '3', 'key-cross-version-006'], 'SN002');
    await tx.refused(`UPDATE santulan.responses SET response_value = '1' WHERE response_id = $1`, [r2], 'SN004');   // B05-017
    await tx.refused('DELETE FROM santulan.responses WHERE response_id = $1', [r2], 'SN004');                       // B05-018
    await tx.refused(`UPDATE santulan.responses SET is_current = true WHERE response_id = $1`, [r1], 'SN004');      // cannot resurrect

    // pause -> resume (sessions 2..4) -> fifth session refused (RC-08)
    await tx.exec('SELECT santulan.pause_session($1, $2)', [a.attempt_id, 'test']);
    for (const n of [2, 3, 4]) {
      expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(n);
      await tx.exec('SELECT santulan.pause_session($1, $2)', [a.attempt_id, 'test']);
    }
    await tx.refused('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id], 'SN005');
    expect((await tx.one('SELECT status, session_count FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.attempt_id]))).toEqual({ status: 'PAUSED', session_count: 4 });

    // submit from PAUSED is atomic; further writes are refused (RC-03)
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-schema-0001']);
    const done = await tx.one('SELECT status, submitted_at FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.attempt_id]);
    expect(done.status).toBe('SUBMITTED');
    expect(done.submitted_at).not.toBeNull();
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item2.item_id, '3', 'key-after-submit-0007'], 'SN008');
    await tx.refused(`UPDATE santulan.assessment_attempts SET status = 'IN_PROGRESS' WHERE attempt_id = $1`, [a.attempt_id], 'SN003');
  }));

  test('attempt provenance is immutable and the actor check blocks other participants', () => withTx(async (tx) => {
    const p1 = await tx.participant({ age: 15 });
    const p2 = await tx.participant({ age: 15 });
    await tx.verifyConsents(p1.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p1.participant_id, v.assessment_version_id, 15);
    await tx.refused(`UPDATE santulan.assessment_attempts SET participant_id = $1 WHERE attempt_id = $2`, [p2.participant_id, a.attempt_id], 'SN004');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: p2.participant_id });   // B05-036 another participant's attempt
    await tx.refused('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id], 'SN011');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: p1.participant_id });
    expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(1);
  }));
});

describe('scoring, reporting and audit guards (BUILD 01 §7)', () => {
  test('score completeness / evidence rules; provenance must match the attempt; audit is append-only', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 15 });
    await tx.verifyConsents(p.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p.participant_id, v.assessment_version_id, 15);
    const other = await tx.participant({ age: 15 });
    const ins = (raw, comp, state, domain = 'C1', part = p.participant_id, ver = v.assessment_version_id) =>
      tx.exec(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
               VALUES ($1,$2,$3,$7,$4,$5,$6,'sv-test')`, [a.attempt_id, part, ver, raw, comp, state, domain]);
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',3.00,1,'S1','sv-test')`, [a.attempt_id, other.participant_id, v.assessment_version_id], 'SN010');
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',6.00,1,'S1','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id], '23514');   // raw out of 1..5
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',3.00,0.50,'S1','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id], '23514'); // < 60 % => no raw score
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',3.00,0.80,'S2','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id], '23514'); // exactly 20 % missing => no S2+
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',3.00,1,'S3','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id], 'SN011');   // S3 needs the release gate
    await ins(3.5, 1, 'S1');
    await ins(null, 0.5, 'S0', 'C2');
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1,$2,$3,'C1',2.00,1,'S1','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id], '23505'); // one row per domain per scoring version

    await tx.exec(`INSERT INTO santulan.audit_logs (actor_type, action_type, target_entity) VALUES ('SYSTEM','TEST','X')`);
    await tx.refused(`UPDATE santulan.audit_logs SET action_type = 'Y'`, [], 'SN004');
    await tx.refused('DELETE FROM santulan.audit_logs', [], 'SN004');
  }));

  test('B06 Q09 must be CRITICAL; B07 REPORT_READY requires a SCORED attempt; sections are not released early', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 15 });
    await tx.verifyConsents(p.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p.participant_id, v.assessment_version_id, 15);
    await tx.refused(`INSERT INTO santulan.quality_flags (attempt_id, flag_code, severity) VALUES ($1,'Q09','LOW')`, [a.attempt_id], '23514');
    await tx.exec(`INSERT INTO santulan.quality_flags (attempt_id, flag_code, severity) VALUES ($1,'Q09','CRITICAL')`, [a.attempt_id]);
    await tx.refused(`INSERT INTO santulan.reports (participant_id, attempt_id, report_version, report_type, generation_status) VALUES ($1,$2,'r1','FULL','REPORT_READY')`, [p.participant_id, a.attempt_id], 'SN010');
    const r = await tx.one(`INSERT INTO santulan.reports (participant_id, attempt_id, report_version, report_type) VALUES ($1,$2,'r1','FULL') RETURNING report_id`, [p.participant_id, a.attempt_id]);
    await tx.refused(`INSERT INTO santulan.report_sections (report_id, section_type, is_released_to_participant, content_version, display_order, content_snapshot)
                      VALUES ($1,'PROFILE',true,'c1',1,'x')`, [r.report_id], 'SN010');            // report still PENDING
    await tx.exec(`INSERT INTO santulan.report_sections (report_id, section_type, content_version, display_order, content_snapshot) VALUES ($1,'PROFILE','c1',1,'x')`, [r.report_id]);
  }));
});

describe('row-level security as the runtime role (SEC-01…10, B07-016, B06-052)', () => {
  test('participants see only their own rows; institution scope needs an exact non-NULL match; OPEN rows are never a tenant', () => withTx(async (tx) => {
    const iA = await tx.institution();
    const iB = await tx.institution();
    const cA = await tx.cohort(iA.institution_id);
    const cB = await tx.cohort(iB.institution_id);
    const pA = await tx.participant({ age: 15, route: 'INSTITUTIONAL', institutionId: iA.institution_id, cohortId: cA.cohort_id });
    const pB = await tx.participant({ age: 15, route: 'INSTITUTIONAL', institutionId: iB.institution_id, cohortId: cB.cohort_id });
    const pOpen = await tx.participant({ age: 15 });

    await tx.asRole('app_runtime');
    const ids = async () => (await tx.q(`SELECT participant_id FROM santulan.participants WHERE santulan_id LIKE 'STN-TEST%'`)).map((r) => r.participant_id).sort();

    await tx.ctx({});                                                                                   // SEC-10 no context
    expect(await ids()).toEqual([]);
    await tx.ctx({ scope: 'PARTICIPANT', participantId: pA.participant_id });                           // SEC-04 own row only
    expect(await ids()).toEqual([pA.participant_id]);
    await tx.ctx({ scope: 'INSTITUTION_ADMIN', institutionId: iA.institution_id });                     // SEC-01/03 tenant A only, no OPEN rows
    expect(await ids()).toEqual([pA.participant_id]);
    await tx.ctx({ scope: 'INSTITUTION_ADMIN' });                                                       // NULL tenant never matches OPEN rows
    expect(await ids()).toEqual([]);
    await tx.ctx({ scope: 'SUPER_ADMIN' });                                                             // SEC-07 global
    expect(await ids()).toEqual([pA.participant_id, pB.participant_id, pOpen.participant_id].sort());
    expect(iB.institution_id).toBeTruthy();
  }));

  test('participants cannot write consents/participants directly, read admin/audit tables, or see S1 scores / draft content', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 15 });
    await tx.verifyConsents(p.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p.participant_id, v.assessment_version_id, 15);
    await tx.exec(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                   VALUES ($1,$2,$3,'C1',3.50,1,'S1','sv-test'), ($1,$2,$3,'C2',3.50,1,'S2','sv-test')`, [a.attempt_id, p.participant_id, v.assessment_version_id]);
    await tx.exec(`INSERT INTO santulan.audit_logs (actor_type, action_type, target_entity) VALUES ('SYSTEM','TEST','X')`);

    await tx.asRole('app_runtime');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: p.participant_id });
    // B06-052: S1 is research-only; only the S2 row is visible
    expect((await tx.q('SELECT domain_code FROM santulan.score_results')).map((r) => r.domain_code)).toEqual(['C2']);
    // SEC-06: no admin_users / research_exports / audit_logs
    expect((await tx.q('SELECT 1 FROM santulan.admin_users')).length).toBe(0);
    expect((await tx.q('SELECT 1 FROM santulan.audit_logs')).length).toBe(0);
    // draft/inactive content is hidden from participants; frozen catalog is readable
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.development_actions')).n).toBe(0);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.reflection_prompts')).n).toBe(0);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.items')).n).toBe(175);
    // writes to consents / participants / attempts / responses are refused (privilege or policy)
    await tx.refused(`INSERT INTO santulan.consents (participant_id, consent_type, giver_relationship, protocol_version) VALUES ($1,'STUDENT_ASSENT','SELF','v9')`, [p.participant_id], '42501');
    await tx.refused(`UPDATE santulan.participants SET status = 'SUSPENDED'`, [], '42501');
    await tx.refused(`INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,15)`, [p.participant_id, v.assessment_version_id], '42501');
    // the app role cannot call the delivery procedures directly and does not inherit the worker's privileges
    await tx.refused('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id], '42501');
  }));

  test('the worker role runs the delivery procedures under a participant context (controlled write path)', () => withTx(async (tx) => {
    const p = await tx.participant({ age: 15 });
    await tx.verifyConsents(p.participant_id, true);
    const v = await tx.openVersion(ADOL);
    const a = await tx.attempt(p.participant_id, v.assessment_version_id, 15);
    await tx.asRole('santulan_worker');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: p.participant_id });
    expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(1);
    const item = await tx.one(`SELECT item_id FROM santulan.items WHERE assessment_version_id = $1 ORDER BY display_order LIMIT 1`, [v.assessment_version_id]);
    const saved = await tx.one('SELECT santulan.save_response($1,$2,$3,900,1,$4) AS id', [a.attempt_id, item.item_id, '4', 'worker-key-000000001']);
    expect(saved.id).toBeTruthy();
  }));
});
