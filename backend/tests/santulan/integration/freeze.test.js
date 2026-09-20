/*
 * T046 — controlled freeze / open actions (BUILD 01 §12, B05-034). Runs on the SCRATCH database inside one outer
 * transaction that is rolled back; each action runs in a savepoint. The tests share that transaction, so they are ordered.
 */
const { Client } = require('pg');
const crypto = require('crypto');
const { camelRows } = require('../../../src/shared/db');
const { CatalogReconcileError } = require('../../../src/modules/santulan/catalog/reconcile');
const freeze = require('../../../src/modules/santulan/catalog/freeze');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const EA = 'santulan-emergingadult-pilot-v3.1';
let client;

const tx = { query: async (text, params) => { const r = await client.query(text, params); return { rows: camelRows(r.rows), rowCount: r.rowCount }; } };
const act = async (fn) => {
  await client.query('SAVEPOINT freeze_call');
  try { const out = await fn(tx); await client.query('RELEASE SAVEPOINT freeze_call'); return out; } catch (e) { await client.query('ROLLBACK TO SAVEPOINT freeze_call'); throw e; }
};
const refused = async (fn, matcher) => {
  const e = await act(fn).then(() => null, (x) => x);
  expect(e).toBeInstanceOf(CatalogReconcileError);
  expect(e.message).toMatch(matcher);
};
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const states = async () => (await client.query('SELECT version_label, status, participation_state, frozen_at FROM santulan.assessment_versions ORDER BY version_label')).rows;

const signed = Buffer.from(`${JSON.stringify({
  anchorLabels: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' },
  keyingDefinition: { POSITIVE: 'item_score = response_value' },
}, null, 2)}\n`, 'utf8');
const signedHash = crypto.createHash('sha256').update(signed).digest('hex');

beforeAll(async () => {
  if (!/(test|qual|scratch)/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('refusing to run outside a scratch database');
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.actor_scope', 'SYSTEM', true)");
});
afterAll(async () => { await client.query('ROLLBACK'); await client.end(); });

describe('refusals before anything changes', () => {
  test('the placeholder, a missing file, a wrong hash and malformed anchors are all refused', async () => {
    for (const bad of [undefined, '', '0'.repeat(64), 'f'.repeat(64), 'PLACEHOLDER', 'REPLACE_WITH_SIGNED_HASH', 'abc123', '<approved-hash>']) {
      await refused((t) => freeze.freezeScale(t, { approvedHash: bad, anchorsBytes: signed }), /approval hash/);
    }
    await refused((t) => freeze.freezeScale(t, { approvedHash: signedHash, anchorsBytes: null }), /anchor file is required/);
    await refused((t) => freeze.freezeScale(t, { approvedHash: 'a'.repeat(64), anchorsBytes: signed }), /does not match the approved hash/);
    const missingPoint = Buffer.from(JSON.stringify({ anchorLabels: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }, keyingDefinition: { POSITIVE: 'x' } }));
    await refused((t) => freeze.freezeScale(t, { approvedHash: crypto.createHash('sha256').update(missingPoint).digest('hex'), anchorsBytes: missingPoint }), /non-empty label for each of the 5 points/);
    const blank = Buffer.from(JSON.stringify({ anchorLabels: { 1: 'a', 2: '', 3: 'c', 4: 'd', 5: 'e' }, keyingDefinition: { POSITIVE: 'x' } }));
    await refused((t) => freeze.freezeScale(t, { approvedHash: crypto.createHash('sha256').update(blank).digest('hex'), anchorsBytes: blank }), /non-empty label/);
    expect((await one('SELECT status FROM santulan.response_scales')).status).toBe('DRAFT');
  });

  test('--test-only is refused on a database that is not a scratch database', async () => {
    const fake = { query: async (text) => (/current_database/.test(text) ? { rows: [{ name: 'santulandb' }] } : { rows: [] }) };
    const e = await freeze.freezeScale(fake, { testOnly: true }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(CatalogReconcileError);
    expect(e.message).toMatch(/--test-only is refused on database "santulandb"/);
  });

  test('--test-only freezes the scale without a signed file on a scratch database and records that in the audit', async () => {
    await client.query('SAVEPOINT tonly');
    const r = await freeze.freezeScale(tx, { testOnly: true, correlationId: 'test-only-corr' });
    expect(r).toMatchObject({ testOnly: true, approvedHash: null });
    expect((await one(`SELECT new_state FROM santulan.audit_logs WHERE correlation_id = 'test-only-corr'`)).new_state.testOnly).toBe(true);
    await client.query('ROLLBACK TO SAVEPOINT tonly');
    expect((await one('SELECT status FROM santulan.response_scales')).status).toBe('DRAFT');
  });

  test('versions cannot be frozen before the scale, and participation cannot open on a DRAFT version', async () => {
    await refused((t) => freeze.freezeVersions(t), /response scale is DRAFT, expected FROZEN/);
    await refused((t) => freeze.openVersion(t, { label: ADOL }), /participation can only change on a FROZEN version/);
    await refused((t) => freeze.openVersion(t, { label: 'no-such-version' }), /unknown assessment version/);
    expect((await states()).every((s) => s.status === 'DRAFT' && s.participation_state === 'CLOSED')).toBe(true);
  });
});

describe('the ordered, audited release sequence', () => {
  test('signed scale freeze applies the approved anchors, records the hash, and is audited', async () => {
    const r = await act((t) => freeze.freezeScale(t, { approvedHash: signedHash, anchorsBytes: signed, correlationId: 'freeze-scale-corr', operator: 'jest' }));
    expect(r).toMatchObject({ action: 'freeze-scale', approvedHash: signedHash, testOnly: false });
    const scale = await one('SELECT status, frozen_at, content_hash, anchor_labels FROM santulan.response_scales');
    expect(scale).toMatchObject({ status: 'FROZEN', content_hash: signedHash });
    expect(scale.frozen_at).toBeTruthy();
    expect(scale.anchor_labels['5']).toBe('Almost always');
    const audit = await one(`SELECT action_type, new_state FROM santulan.audit_logs WHERE correlation_id = 'freeze-scale-corr'`);
    expect(audit.action_type).toBe('SCALE_FROZEN');
    expect(audit.new_state).toMatchObject({ approvedHash: signedHash, operator: 'jest', testOnly: false });
    await refused((t) => freeze.freezeScale(t, { approvedHash: signedHash, anchorsBytes: signed }), /response scale is FROZEN, expected DRAFT/);
    await expect(client.query('SAVEPOINT s1').then(() => client.query("UPDATE santulan.response_scales SET content_hash = 'x'"))).rejects.toMatchObject({ code: 'SN004' });
    await client.query('ROLLBACK TO SAVEPOINT s1');
  });

  test('versions freeze only when the catalog matches exactly; drift blocks the freeze', async () => {
    await client.query('SAVEPOINT drift');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query("UPDATE santulan.items SET item_text = item_text || '!' WHERE item_code = 'C1-01'");
    await client.query("SET LOCAL session_replication_role = 'origin'");
    await refused((t) => freeze.freezeVersions(t), /catalog drift: different: .* C1-01\.item_text/);
    await client.query('ROLLBACK TO SAVEPOINT drift');
    expect((await states()).every((s) => s.status === 'DRAFT')).toBe(true);

    const r = await act((t) => freeze.freezeVersions(t, { correlationId: 'freeze-versions-corr' }));
    expect(r.versions.sort()).toEqual([ADOL, EA]);
    const after = await states();
    expect(after.every((s) => s.status === 'FROZEN' && s.frozen_at && s.participation_state === 'CLOSED')).toBe(true);   // frozen but still CLOSED
    const audits = (await client.query(`SELECT action_type FROM santulan.audit_logs WHERE correlation_id = 'freeze-versions-corr'`)).rows;
    expect(audits.map((a) => a.action_type)).toEqual(['ASSESSMENT_VERSION_FROZEN', 'ASSESSMENT_VERSION_FROZEN']);
    await refused((t) => freeze.freezeVersions(t), /status is FROZEN, expected DRAFT/);

    // T-B02-011 / B05-034: frozen content is immutable
    await client.query('SAVEPOINT imm');
    await expect(client.query("UPDATE santulan.items SET item_text = 'changed' WHERE item_code = 'C1-01'")).rejects.toMatchObject({ code: 'SN004' });
    await client.query('ROLLBACK TO SAVEPOINT imm');
  });

  test('opening participation is a separate audited change, per version, and closing is reversible', async () => {
    const r = await act((t) => freeze.openVersion(t, { label: ADOL, correlationId: 'open-corr', operator: 'jest' }));
    expect(r).toMatchObject({ action: 'open', participationState: 'OPEN' });
    const s = await states();
    expect(s.find((v) => v.version_label === ADOL).participation_state).toBe('OPEN');
    expect(s.find((v) => v.version_label === EA).participation_state).toBe('CLOSED');     // the other form is untouched
    expect((await one(`SELECT action_type FROM santulan.audit_logs WHERE correlation_id = 'open-corr'`)).action_type).toBe('PARTICIPATION_OPENED');
    await refused((t) => freeze.openVersion(t, { label: ADOL }), /already OPEN/);

    expect((await act((t) => freeze.openVersion(t, { label: EA }))).participationState).toBe('OPEN');   // opening the second form still verifies only its own content
    expect((await act((t) => freeze.closeVersion(t, { label: EA }))).participationState).toBe('CLOSED');
    await refused((t) => freeze.closeVersion(t, { label: EA }), /already CLOSED/);
  });
});
