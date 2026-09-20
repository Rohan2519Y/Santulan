/*
 * T090 — scoring arithmetic against KNOWN VECTORS (BUILD 06 §3, §6). The scorer lives in the database (server-only), so the
 * vectors run through santulan.score_attempt in the rolled-back harness; the expected values are computed here in JS from the
 * committed catalog files, independently of the SQL. Denominators are the eligible items of the attempt's own frozen version.
 */
const { withTx } = require('../harness');
const F = require('../helpers/scoringFixtures');

const ENUM_EXPECTED = {
  [F.ADOL]: { C1: 24, C2: 24, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 },
  [F.EA]: { C1: 23, C2: 21, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 },
};

describe.each([F.ADOL, F.EA])('domain means for %s', (label) => {
  test('eligible-item denominators match the frozen catalog', () => {
    for (const [d, n] of Object.entries(ENUM_EXPECTED[label])) expect(F.eligibleCount(label, d)).toBe(n);
  });

  test('all answers 1 -> every domain mean 1.00, complete, one row per domain (A01, A07, A08, A10)', () => withTx(async (tx) => {
    const s = await F.submittedAttempt(tx, { label, value: () => '1', quality: 'CLEAR' });
    expect((await F.score(tx, s.a.attempt_id)).outcome).toBe('SCORED');
    const rows = await F.scoreRows(tx, s.a.attempt_id);
    expect(rows.map((r) => r.domain_code)).toEqual(F.DOMAINS);
    for (const r of rows) expect([r.raw_score, r.completeness_rate, r.score_status]).toEqual(['1.00', '1.0000', 'S1']);
  }));

  test('all answers 5 -> every domain mean 5.00', () => withTx(async (tx) => {
    const s = await F.submittedAttempt(tx, { label, value: () => '5', quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id);
    expect((await F.scoreRows(tx, s.a.attempt_id)).map((r) => r.raw_score)).toEqual(Array(7).fill('5.00'));
  }));

  test('a mixed vector matches hand-computed (JS) means; means are rounded to 2 decimals', () => withTx(async (tx) => {
    const value = (r) => String(((Number(r.display_order) * 7 + r.item_code.length) % 5) + 1);
    const s = await F.submittedAttempt(tx, { label, value, quality: 'CLEAR' });
    await F.score(tx, s.a.attempt_id);
    const rows = await F.scoreRows(tx, s.a.attempt_id);
    const expected = F.expectedMeans(label, value);
    expect(Object.fromEntries(rows.map((r) => [r.domain_code, r.raw_score]))).toEqual(expected);
    expect(new Set(Object.values(expected)).size).toBeGreaterThan(1);                          // the vector really varies by domain
  }));

  test('only the CURRENT response version of an item is used (A01)', () => withTx(async (tx) => {
    const s = await F.submittedAttempt(tx, { label, value: () => '2' });
    // revise the first C1 item 2 -> 5 as a new immutable version, before quality/scoring (attempt is SUBMITTED, so use the owner path)
    const first = s.items.find((i) => i.domain_code === 'C1');
    const old = await tx.one('SELECT response_id FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2', [s.a.attempt_id, first.item_id]);
    await tx.exec('SET LOCAL session_replication_role = replica');
    await tx.exec('UPDATE santulan.responses SET is_current = false WHERE response_id = $1', [old.response_id]);
    await tx.exec(`INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, supersedes_response_id, idempotency_key)
                   VALUES ($1, $2, '5', 2, true, $3, 'fixture-revision-1')`, [s.a.attempt_id, first.item_id, old.response_id]);
    await tx.exec("SET LOCAL session_replication_role = 'origin'");
    await F.qualityEvent(tx, s.a.attempt_id, 'CLEAR');
    await F.score(tx, s.a.attempt_id);
    const c1 = (await F.scoreRows(tx, s.a.attempt_id))[0];
    const n = F.eligibleCount(label, 'C1');
    expect(c1.raw_score).toBe(((2 * (n - 1) + 5) / n).toFixed(2));
  }));
});
