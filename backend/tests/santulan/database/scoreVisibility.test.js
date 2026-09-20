/*
 * T092 — participant visibility of scores (B06-042, 052, SEC-01/05): as the runtime role with a PARTICIPANT context, S0 / S1 / SH
 * rows and the research view are unreadable, a participant's own S2 rows are readable, and nobody else's are.
 */
const { withTx } = require('../harness');
const F = require('../helpers/scoringFixtures');

const ALL_S2 = Object.fromEntries(F.DOMAINS.map((d) => [d, 'S2']));

async function scored(tx, evidence) {
  const s = await F.submittedAttempt(tx, { label: F.ADOL, quality: 'CLEAR' });
  await F.score(tx, s.a.attempt_id, 'scoring-test-v1', evidence);
  return s;
}
const asParticipant = async (tx, s) => {
  await tx.asRole('app_runtime');
  await tx.ctx({ scope: 'PARTICIPANT', participantId: s.p.participant_id });
};
const visible = async (tx, attemptId) => (await tx.q('SELECT domain_code, score_status FROM santulan.score_results WHERE attempt_id = $1 ORDER BY domain_code', [attemptId]));

describe('score visibility for participants', () => {
  test('S1 (the default), S0 and SH rows are hidden; only S2+ rows of the participant\'s own attempt are readable', () => withTx(async (tx) => {
    const mixed = await scored(tx, { C1: 'S2', C2: 'S2', C3: 'SH' });                        // C4-C7 stay S1
    const defaults = await scored(tx, {});                                                    // everything S1
    const s0 = await F.submittedAttempt(tx, { label: F.ADOL, value: (r) => (r.domain_code === 'C1' ? null : '3'), quality: 'CLEAR' });
    await F.score(tx, s0.a.attempt_id, 'scoring-test-v1', ALL_S2);                            // C1 has no answers -> S0; others S2

    await asParticipant(tx, mixed);
    expect(await visible(tx, mixed.a.attempt_id)).toEqual([{ domain_code: 'C1', score_status: 'S2' }, { domain_code: 'C2', score_status: 'S2' }]);
    expect(await visible(tx, defaults.a.attempt_id)).toEqual([]);                             // not theirs (and would be hidden anyway)

    await tx.asOwner(); await tx.asRole('app_runtime');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: defaults.p.participant_id });
    expect(await visible(tx, defaults.a.attempt_id)).toEqual([]);                             // own rows, all S1: hidden (research only)

    await tx.ctx({ scope: 'PARTICIPANT', participantId: s0.p.participant_id });
    const own = await visible(tx, s0.a.attempt_id);
    expect(own.map((r) => r.domain_code)).toEqual(['C2', 'C3', 'C4', 'C5', 'C6', 'C7']);      // the S0 domain (C1) is hidden
    expect(own.every((r) => r.score_status === 'S2')).toBe(true);
  }));

  test('another participant\'s S2 rows are unreadable, and with no context nothing is readable', () => withTx(async (tx) => {
    const a = await scored(tx, ALL_S2);
    const b = await F.submittedAttempt(tx, { label: F.ADOL, quality: 'CLEAR' });
    await asParticipant(tx, a);
    expect((await visible(tx, a.a.attempt_id))).toHaveLength(7);
    await tx.ctx({ scope: 'PARTICIPANT', participantId: b.p.participant_id });
    expect(await visible(tx, a.a.attempt_id)).toEqual([]);
    await tx.ctx({});
    expect(await visible(tx, a.a.attempt_id)).toEqual([]);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.score_results')).n).toBe(0);
  }));

  test('the runtime role cannot execute the scorer or read the research-only candidate subdomain view', () => withTx(async (tx) => {
    const s = await scored(tx, ALL_S2);
    await asParticipant(tx, s);
    await tx.refused('SELECT * FROM santulan.v_candidate_subdomain_scores', [], '42501');
    await tx.refused('SELECT santulan.score_attempt($1, $2, $3::jsonb)', [s.a.attempt_id, 'x', '{}'], '42501');
    await tx.refused('SELECT santulan.build06_apply_q06($1)', [s.a.attempt_id], '42501');
    await tx.refused(`INSERT INTO santulan.score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
                      VALUES ($1, $2, $3, 'C1', 5, 1, 'S2', 'forged')`, [s.a.attempt_id, s.p.participant_id, s.v.assessment_version_id], '42501');
    // quality flags: the runtime role holds UPDATE for institution-admin review, so a participant context is stopped by RLS
    // (no rows visible or changeable) rather than by a privilege error
    await tx.asOwner();
    await tx.exec(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, NULL, 'Q07', 'LOW')`, [s.a.attempt_id]);
    await asParticipant(tx, s);
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.quality_flags')).n).toBe(0);
    expect((await tx.exec("UPDATE santulan.quality_flags SET disposition = 'DISMISSED'")).rowCount).toBe(0);
  }));

  test('the worker role (controlled write path) can read the view under a privileged context', () => withTx(async (tx) => {
    const s = await scored(tx, ALL_S2);
    await tx.asRole('santulan_worker');
    await tx.ctx({ scope: 'SYSTEM' });
    expect((await tx.one('SELECT count(*)::int AS n FROM santulan.v_candidate_subdomain_scores WHERE attempt_id = $1', [s.a.attempt_id])).n).toBe(72);
  }));
});
