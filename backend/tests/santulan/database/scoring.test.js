/*
 * T091 — BUILD 06 scoring and quality controls in the database (B06-001…060 selection). Every test runs in a rolled-back
 * transaction as the owner with the SYSTEM context (the server context); visibility tests live in scoreVisibility.test.js.
 */
const { withTx } = require('../harness');
const F = require('../helpers/scoringFixtures');

const submitted = (tx, opts = {}) => F.submittedAttempt(tx, { label: F.ADOL, ...opts });

describe('quality must complete first (B06-001, 003, 004, 005, 007)', () => {
  test('scoring is refused without a CLEAR outcome, after HOLD or INVALID, and unless the attempt is SUBMITTED', () => withTx(async (tx) => {
    const s = await submitted(tx);
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN013');       // no quality event at all
    await F.qualityEvent(tx, s.a.attempt_id, 'HOLD');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN013');       // latest outcome HOLD
    await F.qualityEvent(tx, s.a.attempt_id, 'INVALID');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN013');
    await F.qualityEvent(tx, s.a.attempt_id, 'CLEAR');                                                                  // the latest event decides
    expect((await F.score(tx, s.a.attempt_id)).outcome).toBe('SCORED');

    const early = await F.submittedAttempt(tx, { label: F.ADOL });
    await tx.exec(`UPDATE santulan.assessment_attempts SET status = 'QUALITY_HOLD' WHERE attempt_id = $1`, [early.a.attempt_id]);
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [early.a.attempt_id, 'v1', '{}'], 'SN003');   // not SUBMITTED
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', ['00000000-0000-4000-8000-000000000000', 'v1', '{}'], 'P0002');
  }));

  test('a version or scale that is not FROZEN, a blank scoring version, and a non-privileged context are refused', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, '  ', '{}'], '23514');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: s.p.participant_id });
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN011');       // no client score authority
    await tx.ctx({});
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN011');       // no context: fail closed
    await tx.ctx({ scope: 'SYSTEM' });
    await tx.exec('SET LOCAL session_replication_role = replica');
    await tx.exec(`UPDATE santulan.response_scales SET status = 'DRAFT'`);
    await tx.exec("SET LOCAL session_replication_role = 'origin'");
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN009');
    expect(await F.scoreRows(tx, s.a.attempt_id)).toEqual([]);
  }));
});

describe('keying, eligibility and provenance (B06-011…015, 019, 022, 023)', () => {
  test('a REVERSE-keyed item hard-fails closed and leaves no rows', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    await tx.exec('SET LOCAL session_replication_role = replica');
    await tx.exec(`UPDATE santulan.items SET keying = 'REVERSE' WHERE item_id = $1`, [s.items[0].item_id]);
    await tx.exec("SET LOCAL session_replication_role = 'origin'");
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN007');
    expect(await F.scoreRows(tx, s.a.attempt_id)).toEqual([]);
  }));

  test('an item outside the version age/context eligibility never enters the denominator or the mean', () => withTx(async (tx) => {
    const c1 = (r) => r.domain_code === 'C1';
    const s = await submitted(tx, { value: (r) => (c1(r) ? '4' : '3'), quality: 'CLEAR' });
    const victim = s.items.find((i) => i.domain_code === 'C1');
    await tx.exec('SET LOCAL session_replication_role = replica');
    await tx.exec(`UPDATE santulan.items SET context = 'College/Work' WHERE item_id = $1`, [victim.item_id]);       // not an adolescent context
    await tx.exec(`UPDATE santulan.responses SET response_value = '1' WHERE item_id = $1 AND attempt_id = $2`, [victim.item_id, s.a.attempt_id]);
    await tx.exec("SET LOCAL session_replication_role = 'origin'");
    await F.score(tx, s.a.attempt_id);
    const c1Row = (await F.scoreRows(tx, s.a.attempt_id))[0];
    expect(c1Row).toMatchObject({ domain_code: 'C1', raw_score: '4.00', completeness_rate: '1.0000' });               // the ineligible '1' is ignored
  }));

  test('a response to another version\'s item is Q06: hard scoring stop, INVALID, an idempotent flag, no scores', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    const other = await tx.item(F.EA, 1);
    await tx.exec('SET LOCAL session_replication_role = replica');
    await tx.exec(`INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key) VALUES ($1, $2, '3', 1, true, 'fixture-cross-version')`, [s.a.attempt_id, other.item_id]);
    await tx.exec("SET LOCAL session_replication_role = 'origin'");
    expect((await tx.one('SELECT santulan.build06_detect_q06($1) AS d', [s.a.attempt_id])).d).toBe(true);
    expect((await F.score(tx, s.a.attempt_id)).outcome).toBe('INVALID_Q06');
    expect((await tx.one('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [s.a.attempt_id])).status).toBe('INVALID');
    expect(await tx.q(`SELECT flag_code, severity FROM santulan.quality_flags WHERE attempt_id = $1`, [s.a.attempt_id])).toEqual([{ flag_code: 'Q06', severity: 'HIGH' }]);
    expect(await F.scoreRows(tx, s.a.attempt_id)).toEqual([]);
    await tx.exec('SELECT santulan.build06_apply_q06($1)', [s.a.attempt_id]);                                             // idempotent
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.quality_flags WHERE attempt_id = $1', [s.a.attempt_id])).n).toBe(1);
  }));

  test('participant and version must match the attempt; a different scoring version on a bound attempt is rejected', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    const other = await tx.participant({ age: 15 });
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1, $2, $3, 'C1', 3, 1, 'S1', 'x')`, [s.a.attempt_id, other.participant_id, s.v.assessment_version_id], 'SN010');
    await F.score(tx, s.a.attempt_id, 'scoring-a');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'scoring-b', '{}'], 'SN010');
    expect((await F.scoreRows(tx, s.a.attempt_id)).map((r) => r.scoring_version)).toEqual(Array(7).fill('scoring-a'));
  }));
});

describe('missingness boundaries (B06-025…027, 032; BUILD 06 §7)', () => {
  // C4 has 10 eligible items and C6 has 20, so exactly 20% and 40% missing are whole numbers of items.
  const missing = (domain, n) => {
    const seen = {};
    return (r) => {
      if (r.domain_code !== domain) return '4';
      seen[domain] = (seen[domain] || 0) + 1;
      return seen[domain] <= n ? null : '4';
    };
  };
  const domainRow = async (tx, s, d) => (await F.scoreRows(tx, s.a.attempt_id)).find((r) => r.domain_code === d);

  test('0% and <20% missing: a score, completeness kept, the governed state applies (MS01/MS02)', () => withTx(async (tx) => {
    const s = await submitted(tx, { value: missing('C4', 1), quality: 'CLEAR' });                                         // 1 of 10 = 10%
    await F.score(tx, s.a.attempt_id, 'v1', { C4: 'S2', C1: 'S2' });
    expect(await domainRow(tx, s, 'C4')).toMatchObject({ raw_score: '4.00', completeness_rate: '0.9000', score_status: 'S2' });
    expect(await domainRow(tx, s, 'C1')).toMatchObject({ completeness_rate: '1.0000', score_status: 'S2' });
  }));

  test('EXACTLY 20% missing: the score exists but the participant-facing state stays S1 even when S2 is configured (MS03)', () => withTx(async (tx) => {
    const s = await submitted(tx, { value: missing('C4', 2), quality: 'CLEAR' });                                         // 2 of 10 = exactly 20%
    await F.score(tx, s.a.attempt_id, 'v1', { C4: 'S2' });
    expect(await domainRow(tx, s, 'C4')).toMatchObject({ raw_score: '4.00', completeness_rate: '0.8000', score_status: 'S1' });
  }));

  test('between 20% and 40% missing: research score, S1 (MS03)', () => withTx(async (tx) => {
    const s = await submitted(tx, { value: missing('C6', 6), quality: 'CLEAR' });                                         // 6 of 20 = 30%
    await F.score(tx, s.a.attempt_id, 'v1', { C6: 'S2' });
    expect(await domainRow(tx, s, 'C6')).toMatchObject({ raw_score: '4.00', completeness_rate: '0.7000', score_status: 'S1' });
  }));

  test('EXACTLY 40% missing and above: raw_score is NULL and the state is S0 (MS04)', () => withTx(async (tx) => {
    const a = await submitted(tx, { value: missing('C6', 8), quality: 'CLEAR' });                                         // 8 of 20 = exactly 40%
    await F.score(tx, a.a.attempt_id, 'v1', { C6: 'S2' });
    expect(await domainRow(tx, a, 'C6')).toMatchObject({ raw_score: null, completeness_rate: '0.6000', score_status: 'S0' });
    const b = await submitted(tx, { value: missing('C4', 5), quality: 'CLEAR' });                                         // 5 of 10 = 50%
    await F.score(tx, b.a.attempt_id);
    expect(await domainRow(tx, b, 'C4')).toMatchObject({ raw_score: null, completeness_rate: '0.5000', score_status: 'S0' });
    expect(await domainRow(tx, b, 'C1')).toMatchObject({ raw_score: '4.00', score_status: 'S1' });                      // other domains are unaffected
  }));

  test('a domain with no answers at all is S0 with completeness 0 and no score', () => withTx(async (tx) => {
    const s = await submitted(tx, { value: (r) => (r.domain_code === 'C5' ? null : '3'), quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id);
    expect(await domainRow(tx, s, 'C5')).toMatchObject({ raw_score: null, completeness_rate: '0.0000', score_status: 'S0' });
  }));
});

describe('evidence states and immutability (B06-034, 035, 037, 039…041)', () => {
  test('default is S1; S2 and SH only when configured; S3-S5 need the server release gate; a bad state is refused', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id, 'v1', { C1: 'S2', C2: 'SH' });
    const byDomain = Object.fromEntries((await F.scoreRows(tx, s.a.attempt_id)).map((r) => [r.domain_code, r.score_status]));
    expect(byDomain).toEqual({ C1: 'S2', C2: 'SH', C3: 'S1', C4: 'S1', C5: 'S1', C6: 'S1', C7: 'S1' });

    const t = await submitted(tx, { quality: 'CLEAR' });
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [t.a.attempt_id, 'v1', JSON.stringify({ C3: 'S3' })], 'SN011');
    expect(await F.scoreRows(tx, t.a.attempt_id)).toEqual([]);                                                           // exception mid-loop: C1, C2 were rolled back too
    expect((await tx.one('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [t.a.attempt_id])).status).toBe('SUBMITTED');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [t.a.attempt_id, 'v1', JSON.stringify({ C1: 'S9' })], '22P02');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [t.a.attempt_id, 'v1', JSON.stringify({ C1: 'S0' })], '23514');

    await tx.exec("SELECT set_config('app.allow_advanced_evidence_states', 'on', true)");                                 // the explicit server gate
    expect((await F.score(tx, t.a.attempt_id, 'v1', { C3: 'S3' })).outcome).toBe('SCORED');
    expect((await F.scoreRows(tx, t.a.attempt_id))[2].score_status).toBe('S3');
  }));

  test('success ends at SCORED with a bound scoring version, no report, and a safe identical retry', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    expect((await F.score(tx, s.a.attempt_id, 'scoring-test-v1')).outcome).toBe('SCORED');
    const attempt = await tx.one('SELECT status, scoring_version, completed_at FROM santulan.assessment_attempts WHERE attempt_id = $1', [s.a.attempt_id]);
    expect(attempt.status).toBe('SCORED');
    expect(attempt.scoring_version).toBe('scoring-test-v1');
    expect(attempt.completed_at).not.toBeNull();
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.reports WHERE attempt_id = $1', [s.a.attempt_id])).n).toBe(0);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.growth_plans WHERE participant_id = $1', [s.p.participant_id])).n).toBe(0);
    expect((await F.score(tx, s.a.attempt_id, 'scoring-test-v1')).outcome).toBe('ALREADY_SCORED');
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.score_results WHERE attempt_id = $1', [s.a.attempt_id])).n).toBe(7);
    // raw responses are untouched by scoring
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1', [s.a.attempt_id])).n).toBe(s.items.length);
  }));

  test('score rows are immutable for every role; only a new scoring version could ever add rows', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id);
    await tx.refused(`UPDATE santulan.score_results SET raw_score = 5 WHERE attempt_id = $1`, [s.a.attempt_id], 'SN004');
    await tx.refused(`UPDATE santulan.score_results SET score_status = 'S2' WHERE attempt_id = $1`, [s.a.attempt_id], 'SN004');
    await tx.refused('DELETE FROM santulan.score_results WHERE attempt_id = $1', [s.a.attempt_id], 'SN004');
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1, $2, $3, 'C1', 3, 1, 'S1', 'scoring-test-v1')`, [s.a.attempt_id, s.p.participant_id, s.v.assessment_version_id], '23505');   // (attempt, domain, version) unique
  }));
});

describe('quality flags and outcomes (B06-042…052, 056…059)', () => {
  test('flag detection facts are immutable, review fields are not, and a logical flag is unique per attempt/domain/code', () => withTx(async (tx) => {
    const s = await submitted(tx);
    const admin = await tx.one(`INSERT INTO santulan.admin_users (role, auth_provider, auth_provider_subject_id) VALUES ('SUPER_ADMIN', 'test', $1) RETURNING admin_user_id`, [`adm-${s.a.attempt_id}`]);
    const f = await tx.one(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, 'C1', 'Q01', 'LOW') RETURNING flag_id`, [s.a.attempt_id]);
    await tx.refused(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, 'C1', 'Q01', 'LOW')`, [s.a.attempt_id], '23505');
    await tx.exec(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, 'C2', 'Q01', 'LOW')`, [s.a.attempt_id]);          // another domain is another flag
    await tx.exec(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, NULL, 'Q07', 'LOW')`, [s.a.attempt_id]);
    await tx.refused(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, NULL, 'Q07', 'HIGH')`, [s.a.attempt_id], '23505'); // NULL domain is one logical slot
    for (const set of ["flag_code = 'Q02'", "severity = 'HIGH'", "detected_at = now() - interval '1 day'", "domain_code = 'C3'", "attempt_id = gen_random_uuid()"]) {
      await tx.refused(`UPDATE santulan.quality_flags SET ${set} WHERE flag_id = $1`, [f.flag_id], 'SN004');
    }
    await tx.exec(`UPDATE santulan.quality_flags SET disposition = 'DISMISSED', reviewed_by = $2, reviewed_at = now(), review_note = 'checked' WHERE flag_id = $1`, [f.flag_id, admin.admin_user_id]);
    await tx.refused('DELETE FROM santulan.quality_flags WHERE flag_id = $1', [f.flag_id]);
  }));

  test('Q09 is CRITICAL, routes the attempt to QUALITY_HOLD, blocks a CLEAR outcome and never becomes a score', () => withTx(async (tx) => {
    const s = await submitted(tx, { quality: 'CLEAR' });
    await tx.refused(`INSERT INTO santulan.quality_flags (attempt_id, flag_code, severity) VALUES ($1, 'Q09', 'HIGH')`, [s.a.attempt_id], '23514');
    await tx.exec(`INSERT INTO santulan.quality_flags (attempt_id, flag_code, severity) VALUES ($1, 'Q09', 'CRITICAL')`, [s.a.attempt_id]);
    expect((await tx.one('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [s.a.attempt_id])).status).toBe('QUALITY_HOLD');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'v1', '{}'], 'SN003');
    await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', '{"outcome": "CLEAR"}')`, [s.a.attempt_id], '23514');
    await tx.exec(`INSERT INTO santulan.response_events (attempt_id, event_type, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', '{"outcome": "HOLD"}')`, [s.a.attempt_id]);  // a re-run may still record HOLD
    expect(await F.scoreRows(tx, s.a.attempt_id)).toEqual([]);
  }));

  test('a quality outcome must be CLEAR, HOLD or INVALID and only runs on a SUBMITTED (or held) attempt', () => withTx(async (tx) => {
    const s = await submitted(tx);
    for (const bad of ['{"outcome": "MAYBE"}', '{}', '{"outcome": "clear"}']) {
      await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', $2::jsonb)`, [s.a.attempt_id, bad], '23514');
    }
    const live = await tx.participant({ age: 15 });
    await tx.verifyConsents(live.participant_id, true);
    const running = await tx.attempt(live.participant_id, s.v.assessment_version_id, 15);
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [running.attempt_id]);
    await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', '{"outcome": "CLEAR"}')`, [running.attempt_id], 'SN003');
  }));

  test('the catalog stays POSITIVE-only and the schema stays at 28 tables', () => withTx(async (tx) => {
    expect((await tx.one(`SELECT count(*)::int AS n FROM santulan.items WHERE keying <> 'POSITIVE'`)).n).toBe(0);
    expect((await tx.one(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE'`)).n).toBe(28);
  }));
});

describe('research-only candidate subdomain view (B06-056…059, AT candidate subdomains)', () => {
  test('C4.2 and C2.10 carry interpretation_hold, means are per subdomain, and held items still count in the C4/C2 domain means', () => withTx(async (tx) => {
    const value = (r) => String(((Number(r.display_order) * 3 + r.item_code.length) % 5) + 1);
    const s = await submitted(tx, { value, quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id);
    const rows = await tx.q('SELECT domain_code, subdomain_code, eligible_items, answered_items, candidate_mean, interpretation_hold FROM santulan.v_candidate_subdomain_scores WHERE attempt_id = $1 ORDER BY subdomain_code', [s.a.attempt_id]);
    expect(rows).toHaveLength(72);
    expect(rows.filter((r) => r.interpretation_hold).map((r) => r.subdomain_code).sort()).toEqual(['C2.10', 'C4.2']);
    for (const r of rows) expect(r.answered_items).toBe(r.eligible_items);

    const expected = {};
    for (const r of F.eligibleRows(F.ADOL)) (expected[r.subdomain_code] = expected[r.subdomain_code] || []).push(Number(value(r)));
    for (const r of rows) expect(r.candidate_mean).toBe((expected[r.subdomain_code].reduce((a, b) => a + b, 0) / expected[r.subdomain_code].length).toFixed(2));

    // the held subdomains are still inside the domain means (removing them would change the frozen measurement model)
    const c4 = (await F.scoreRows(tx, s.a.attempt_id)).find((r) => r.domain_code === 'C4');
    expect(c4.raw_score).toBe(F.expectedMeans(F.ADOL, value).C4);
    const c42Items = F.eligibleRows(F.ADOL).filter((r) => r.subdomain_code === 'C4.2').length;
    expect(c42Items).toBeGreaterThan(0);
  }));
});
