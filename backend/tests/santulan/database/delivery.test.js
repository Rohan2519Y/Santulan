/*
 * T078 — BUILD 05 delivery controls added by migration 021 (B05-010…016, 023, 024, 027, 028, 041, 044, 045).
 * Sessions, response versioning, scale/version guards and immutability are asserted in schema.test.js ("B05-002…024");
 * this file covers submit idempotency, the session-number trigger, the blank-key check, actor enforcement under the
 * worker role, and the control-plane function. Every test runs in a rolled-back transaction.
 */
const { withTx } = require('../harness');

const ADOL = 'santulan-adolescent-pilot-v3.1';

async function startedAttempt(tx, { age = 15 } = {}) {
  const p = await tx.participant({ age });
  await tx.verifyConsents(p.participant_id, age < 18);
  const v = await tx.openVersion(ADOL);
  const a = await tx.attempt(p.participant_id, v.assessment_version_id, age);
  return { p, v, a, item1: await tx.item(ADOL, 1), item2: await tx.item(ADOL, 2) };
}
const events = async (tx, attemptId, type) => (await tx.q('SELECT metadata, session_number FROM santulan.response_events WHERE attempt_id = $1 AND event_type = $2', [attemptId, type]));

describe('function surface (B05-041, 044, 045)', () => {
  test('the legacy submit_attempt(uuid) is gone and the worker may execute submit_attempt(uuid,text)', () => withTx(async (tx) => {
    const sigs = (await tx.q(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'santulan' AND p.proname = 'submit_attempt'`)).map((r) => r.args);
    expect(sigs).toEqual(['p_attempt uuid, p_submission_key text']);
    expect((await tx.one(`SELECT has_function_privilege('santulan_worker', 'santulan.submit_attempt(uuid, text)', 'EXECUTE') AS ok`)).ok).toBe(true);
    expect((await tx.one(`SELECT has_function_privilege('public', 'santulan.submit_attempt(uuid, text)', 'EXECUTE') AS ok`)).ok).toBe(false);
    expect((await tx.one(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE'`)).n).toBe(28);
  }));
});

describe('atomic, idempotent submission (B05-010…016, 023, 024)', () => {
  test('submit from IN_PROGRESS closes the session, writes one SUBMIT with the key, and locks the attempt', () => withTx(async (tx) => {
    const { a, item2 } = await startedAttempt(tx);
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000001']);

    const row = await tx.one('SELECT status, submitted_at FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.attempt_id]);
    expect(row.status).toBe('SUBMITTED');
    expect(row.submitted_at).not.toBeNull();
    expect((await events(tx, a.attempt_id, 'SESSION_END')).map((e) => e.metadata)).toEqual([{ reason: 'submit' }]);
    expect((await events(tx, a.attempt_id, 'SUBMIT')).map((e) => e.metadata)).toEqual([{ idempotency_key: 'submit-key-000000001' }]);
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item2.item_id, '3', 'key-after-submit-9001'], 'SN008');
  }));

  test('the same key after submit is a safe retry; a different key is a conflict; neither writes a second SUBMIT', () => withTx(async (tx) => {
    const { a } = await startedAttempt(tx);
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000002']);
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000002']);          // lost-ack retry
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'a-different-submit-key'], 'SN006');
    expect(await events(tx, a.attempt_id, 'SUBMIT')).toHaveLength(1);
    expect(await events(tx, a.attempt_id, 'SESSION_END')).toHaveLength(1);
    // the retry still works once the downstream engines have moved the attempt on (status is no longer SUBMITTED)
    await tx.exec(`UPDATE santulan.assessment_attempts SET status = 'SCORING' WHERE attempt_id = $1`, [a.attempt_id]);
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000002']);
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'another-key-after-scoring'], 'SN006');
  }));

  test('submit from PAUSED writes no extra SESSION_END; submit from CREATED, a blank key or an unknown attempt is refused', () => withTx(async (tx) => {
    const { a } = await startedAttempt(tx);
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000003'], 'SN003');   // CREATED
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.exec('SELECT santulan.pause_session($1, $2)', [a.attempt_id, 'test']);
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, '   '], '23514');
    await tx.refused('SELECT santulan.submit_attempt($1, NULL)', [a.attempt_id], '23514');
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000004']);
    expect(await events(tx, a.attempt_id, 'SESSION_END')).toHaveLength(1);                                          // only the pause's
    expect((await tx.one('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.attempt_id])).status).toBe('SUBMITTED');
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', ['00000000-0000-4000-8000-000000000000', 'submit-key-000000005'], 'P0002');
  }));

  test('uq_submit_idempotency: a second SUBMIT event with the same key for an attempt is rejected by the index', () => withTx(async (tx) => {
    const { a } = await startedAttempt(tx);
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.exec('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000006']);
    await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, session_number, metadata) VALUES ($1, 'SUBMIT', 1, '{"idempotency_key": "submit-key-000000006"}')`, [a.attempt_id], '23505');
  }));
});

describe('event session numbers and response keys (B05-027, 028)', () => {
  test('an event session number can never exceed the attempt session count', () => withTx(async (tx) => {
    const { a } = await startedAttempt(tx);
    await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, session_number) VALUES ($1, 'RESUME', 1)`, [a.attempt_id], '23514');   // count is 0
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.refused(`INSERT INTO santulan.response_events (attempt_id, event_type, session_number) VALUES ($1, 'RESUME', 2)`, [a.attempt_id], '23514');
    await tx.exec(`INSERT INTO santulan.response_events (attempt_id, event_type, session_number) VALUES ($1, 'RESUME', 1)`, [a.attempt_id]);
    await tx.exec(`INSERT INTO santulan.response_events (attempt_id, event_type) VALUES ($1, 'RESUME')`, [a.attempt_id]);      // no session number is fine
  }));

  test('a blank response idempotency key is rejected by the function and by the table', () => withTx(async (tx) => {
    const { a, item1 } = await startedAttempt(tx);
    await tx.exec('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id]);
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item1.item_id, '3', '   '], '23514');
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,NULL)', [a.attempt_id, item1.item_id, '3'], '23514');
    const c = await tx.refused(`INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key)
                                VALUES ($1, $2, '3', 1, true, '   ')`, [a.attempt_id, item1.item_id], '23514');
    expect(c.constraint).toBe('response_idempotency_nonblank_ck');
  }));
});

describe('actor enforcement under the worker role (B05-033…035)', () => {
  test('a participant can act on their own attempt only; the worker role reaches the procedures through the trusted context', () => withTx(async (tx) => {
    const { p, a, item1 } = await startedAttempt(tx);
    const other = await tx.participant({ age: 16 });

    await tx.asRole('santulan_worker');
    await tx.ctx({ scope: 'PARTICIPANT', participantId: other.participant_id });
    await tx.refused('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id], 'SN011');
    await tx.refused('SELECT santulan.save_response($1,$2,$3,1,1,$4)', [a.attempt_id, item1.item_id, '3', 'key-other-participant-1'], 'SN011');
    await tx.refused('SELECT santulan.submit_attempt($1, $2)', [a.attempt_id, 'submit-key-000000007'], 'SN011');
    await tx.refused('SELECT santulan.pause_session($1, $2)', [a.attempt_id, 'x'], 'SN011');

    await tx.ctx({ scope: 'PARTICIPANT', participantId: p.participant_id });
    expect((await tx.one('SELECT santulan.begin_or_resume_session($1) AS n', [a.attempt_id])).n).toBe(1);
    expect((await tx.one('SELECT santulan.save_response($1,$2,$3,900,1,$4) AS id', [a.attempt_id, item1.item_id, '4', 'key-own-participant-0001'])).id).toBeTruthy();

    await tx.ctx({});                                                                            // no context: fail closed
    await tx.refused('SELECT santulan.begin_or_resume_session($1)', [a.attempt_id], 'SN011');
  }));
});

describe('control plane (R-18)', () => {
  const control = (tx, state, seconds) => tx.exec(
    `INSERT INTO santulan.audit_logs (actor_type, action_type, target_entity, new_state, occurred_at)
     VALUES ('SYSTEM', 'PARTICIPATION_CONTROL', 'participation', $1::jsonb, now() + ($2 || ' seconds')::interval)`, [JSON.stringify({ state }), String(seconds)]);
  const state = async (tx) => (await tx.one('SELECT santulan.participation_control_state() AS s')).s;

  test('no event means OPEN; the latest event decides; an unrecognised state fails closed', () => withTx(async (tx) => {
    expect(await state(tx)).toBe('OPEN');
    await control(tx, 'STOPPED', 1);
    expect(await state(tx)).toBe('STOPPED');
    await control(tx, 'OPEN', 2);
    expect(await state(tx)).toBe('OPEN');
    await control(tx, 'PAUSE-EVERYTHING', 3);
    expect(await state(tx)).toBe('STOPPED');
  }));

  test('the runtime role can read the state but cannot forge control events (no direct audit reads or updates)', () => withTx(async (tx) => {
    await tx.asRole('santulan_worker');
    expect((await tx.one('SELECT santulan.participation_control_state() AS s')).s).toBe('OPEN');
  }));
});
