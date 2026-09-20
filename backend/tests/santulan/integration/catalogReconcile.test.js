/*
 * T037 — catalog reconcile / apply / rollback against the SCRATCH database (T-B02-009…020, AT-B00-06/07/08).
 * Every test runs inside one outer transaction that is ROLLED BACK at the end, so the scratch catalog is never left
 * modified; each reconcile call runs in a savepoint so a failure proves its own rollback.
 */
const { Client } = require('pg');
const { camelRows } = require('../../../src/shared/db');
const { reconcileCatalog, CatalogReconcileError } = require('../../../src/modules/santulan/catalog/reconcile');
const { loadCatalogFiles } = require('../../../src/modules/santulan/catalog/catalogFiles');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const EA = 'santulan-emergingadult-pilot-v3.1';
let client;
let files;

const tx = { query: async (text, params) => { const r = await client.query(text, params); return { rows: camelRows(r.rows), rowCount: r.rowCount }; } };
const runTx = async (fn) => {
  await client.query('SAVEPOINT reconcile_call');
  try {
    const out = await fn(tx);
    await client.query('RELEASE SAVEPOINT reconcile_call');
    return out;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT reconcile_call');
    throw err;
  }
};
const run = (opts = {}) => reconcileCatalog({ runTx, files, operator: 'jest', ...opts });

/** Mutations bypass the frozen-content triggers (as the table owner); the reconcile call itself runs with triggers on. */
const mutate = async (sql, params) => {
  await client.query("SET LOCAL session_replication_role = 'replica'");
  try { return await client.query(sql, params); } finally { await client.query("SET LOCAL session_replication_role = 'origin'"); }
};
const versionId = async (label) => (await client.query('SELECT assessment_version_id FROM santulan.assessment_versions WHERE version_label = $1', [label])).rows[0].assessment_version_id;
const count = async (label) => (await client.query('SELECT count(*)::int AS n FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1', [label])).rows[0].n;
const xmins = async () => (await client.query('SELECT item_id, xmin::text AS x FROM santulan.items ORDER BY item_id')).rows;

beforeAll(async () => {
  if (!/(test|qual|scratch)/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('refusing to run outside a scratch database');
  files = loadCatalogFiles();
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.actor_scope', 'SYSTEM', true)");
});
afterAll(async () => {
  await client.query('ROLLBACK');
  await client.end();
});

describe('reconcile is a verified no-op on a clean catalog (T-B02-020)', () => {
  test('exact match: 0 inserts, 0 updates, one audit event with correlation id and manifest hash; versions stay DRAFT/CLOSED', async () => {
    const before = await xmins();
    const correlationId = `reconcile-${Date.now()}`;
    const r1 = await run({ correlationId });
    expect(r1).toMatchObject({ mode: 'reconcile', exitCode: 0, manifestSha256: files.manifestSha256, correlationId, operator: 'jest' });
    expect(r1.versions.map((v) => [v.label, v.expectedRows, v.dbRows, v.noop, v.insertedIds.length])).toEqual([[ADOL, 175, 175, 175, 0], [EA, 171, 171, 171, 0]]);
    expect(r1.dbServerVersion).toBeTruthy();
    expect(r1.checks.every((c) => c.result === 'PASS')).toBe(true);
    expect(r1.derivation.itemIdNamespace).toBe(files.manifest.itemIdNamespace);

    const r2 = await run();
    expect(r2.versions.map((v) => v.noop)).toEqual([175, 171]);
    expect(await xmins()).toEqual(before);                                   // no row was touched

    const audits = (await client.query(`SELECT action_type, new_state FROM santulan.audit_logs WHERE correlation_id = $1`, [correlationId])).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0].action_type).toBe('CATALOG_RECONCILED');
    expect(audits[0].new_state).toMatchObject({ manifestSha256: files.manifestSha256, inserted: 0, noop: 346 });

    const states = (await client.query('SELECT status, participation_state FROM santulan.assessment_versions')).rows;
    expect(states.every((s) => s.status === 'DRAFT' && s.participation_state === 'CLOSED')).toBe(true);
  });
});

describe('every divergence fails, names item_code and field, and rolls back (T-B02-009…019)', () => {
  const rejects = async (opts, matcher) => {
    const before = await xmins();
    const err = await run(opts).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(CatalogReconcileError);
    if (matcher) expect(err.message).toMatch(matcher);
    expect(await xmins()).toEqual(before);
    return err;
  };

  test('changed item_text is reported as item_code + field and the text itself is not echoed', async () => {
    const code = files.items[ADOL][7].item_code;
    await mutate(`UPDATE santulan.items SET item_text = 'TAMPERED-CANARY-TEXT' WHERE item_code = $1 AND assessment_version_id = $2`, [code, await versionId(ADOL)]);
    const err = await rejects({}, new RegExp(`${ADOL} ${code}\\.item_text`));
    expect(err.message).not.toContain('TAMPERED-CANARY-TEXT');
    expect(err.message).not.toContain(files.items[ADOL][7].item_text);
    await mutate(`UPDATE santulan.items SET item_text = $3 WHERE item_code = $1 AND assessment_version_id = $2`, [code, await versionId(ADOL), files.items[ADOL][7].item_text]);
    await run();                                                             // restored: clean again
  });

  test('deleted row, extra row and display-order gap each fail', async () => {
    const vid = await versionId(EA);
    const gone = files.items[EA][3];
    const saved = (await client.query('SELECT * FROM santulan.items WHERE item_code = $1 AND assessment_version_id = $2', [gone.item_code, vid])).rows[0];
    await mutate('DELETE FROM santulan.items WHERE item_id = $1', [saved.item_id]);
    await rejects({}, new RegExp(`missing in ${EA}: ${gone.item_code}`));

    await mutate(
      `INSERT INTO santulan.items (assessment_version_id, item_code, domain_code, subdomain_code, subdomain_name, item_text, keying, age_band, context, layer, pilot_status, display_order, status, item_content_hash)
       VALUES ($1,'C1-99','C1','C1.1','Interoceptive Awareness','extra','POSITIVE','13–25','General','CORE','READY',999,'ACTIVE',$2)`, [vid, 'a'.repeat(64)]);
    await rejects({}, new RegExp(`extra in ${EA}: C1-99`));
    await mutate("DELETE FROM santulan.items WHERE item_code = 'C1-99'");
    await mutate(
      `INSERT INTO santulan.items (item_id, assessment_version_id, item_code, domain_code, subdomain_code, subdomain_name, item_text, keying, age_band, context, layer, pilot_status, display_order, status, item_content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [saved.item_id, saved.assessment_version_id, saved.item_code, saved.domain_code, saved.subdomain_code, saved.subdomain_name, saved.item_text, saved.keying,
        saved.age_band, saved.context, saved.layer, saved.pilot_status, saved.display_order, saved.status, saved.item_content_hash],
    );
    await run();                                                             // restored

    const other = files.items[EA][10].item_code;
    await mutate('UPDATE santulan.items SET display_order = 900 WHERE item_code = $1 AND assessment_version_id = $2', [other, vid]);
    await rejects({}, new RegExp(`${EA} ${other}\\.display_order`));
    await mutate('UPDATE santulan.items SET display_order = $3 WHERE item_code = $1 AND assessment_version_id = $2', [other, vid, Number(files.items[EA][10].display_order)]);
    await run();                                                             // restored
  });

  test('a duplicated item_code or a legacy C4.6 in the catalog files fails offline, before the database is touched', async () => {
    const dup = { ...files, items: { ...files.items, [ADOL]: files.items[ADOL].map((r, i) => (i === 5 ? { ...r, item_code: files.items[ADOL][4].item_code } : r)) } };
    const err = await rejects({ files: dup }, /offline verification failed/);
    expect(err.message).toContain('item_code unique');
    const c46 = { ...files, items: { ...files.items, [ADOL]: files.items[ADOL].map((r, i) => (i === 0 ? { ...r, subdomain_code: 'C4.6' } : r)) } };
    await rejects({ files: c46 }, /offline verification failed/);
  });

  test('a version that is not DRAFT/CLOSED fails (opened participation, frozen status)', async () => {
    const vid = await versionId(ADOL);
    await mutate("UPDATE santulan.assessment_versions SET participation_state = 'OPEN' WHERE assessment_version_id = $1", [vid]);
    await rejects({}, new RegExp(`${ADOL}: participation_state is OPEN, expected CLOSED`));
    await mutate("UPDATE santulan.assessment_versions SET participation_state = 'CLOSED' WHERE assessment_version_id = $1", [vid]);
    await run();
  });

  test('a large drift lists at most 20 entries plus the total, never the bank', async () => {
    const vid = await versionId(ADOL);
    await mutate(`UPDATE santulan.items SET item_text = item_text || '!' WHERE assessment_version_id = $1 AND display_order <= 25`, [vid]);
    const err = await rejects({}, /\(25 total\)/);
    expect(err.message.length).toBeLessThan(1500);
    await mutate(`UPDATE santulan.items SET item_text = left(item_text, length(item_text) - 1) WHERE assessment_version_id = $1 AND display_order <= 25`, [vid]);
    await run();
  });

  test('the manifest hash of a tampered file is caught by the offline checks', async () => {
    const tampered = { ...files, bytes: { ...files.bytes, 'emergingadult_items_v3_1.csv': Buffer.from('tampered') } };
    await rejects({ files: tampered }, /manifest hash emergingadult_items_v3_1\.csv/);
  });
});

describe('apply inserts missing rows only, and rollback-from-receipt removes exactly those (T-B02-015…019)', () => {
  test('apply restores two deleted rows, is idempotent, and the receipt drives a precise rollback', async () => {
    const vid = await versionId(ADOL);
    const victims = [files.items[ADOL][20].item_code, files.items[ADOL][21].item_code];
    await mutate('DELETE FROM santulan.items WHERE assessment_version_id = $1 AND item_code = ANY($2)', [vid, victims]);
    expect(await count(ADOL)).toBe(173);

    const receipt = await run({ mode: 'apply' });
    expect(receipt.mode).toBe('apply');
    expect(receipt.versions.find((v) => v.label === ADOL).insertedIds).toHaveLength(2);
    expect(receipt.versions.find((v) => v.label === EA).insertedIds).toHaveLength(0);
    expect(await count(ADOL)).toBe(175);
    await run();                                                             // canonical again, byte for byte
    expect((await run({ mode: 'apply' })).versions.every((v) => v.insertedIds.length === 0)).toBe(true);   // idempotent

    const rolled = await run({ mode: 'rollback', receipt });
    expect(rolled.mode).toBe('rollback');
    expect(await count(ADOL)).toBe(173);
    expect(await count(EA)).toBe(171);
    await rejects2(() => run(), /missing in santulan-adolescent-pilot-v3\.1/);
    await run({ mode: 'apply' });                                            // back to 175 for the tests that follow
  });

  test('rollback refuses a receipt from another manifest', async () => {
    const receipt = await run({ mode: 'apply' });
    await rejects2(() => run({ mode: 'rollback', receipt: { ...receipt, manifestSha256: 'f'.repeat(64) } }), /does not belong to this catalog manifest/);
  });

  test('apply and rollback are refused once any attempt references the version', async () => {
    const vid = await versionId(EA);
    const item = files.items[EA][30].item_code;
    await mutate('DELETE FROM santulan.items WHERE assessment_version_id = $1 AND item_code = $2', [vid, item]);
    const p = (await mutate(`INSERT INTO santulan.participants (santulan_id, participation_route, age_years_at_registration) VALUES ('STN-TESTCATALOG00000000A','OPEN',20) RETURNING participant_id`)).rows[0];
    await mutate('INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1,$2,20)', [p.participant_id, vid]);

    await rejects2(() => run({ mode: 'apply' }), /apply refused: attempts already reference/);
    expect(await count(EA)).toBe(170);                                       // nothing inserted
    await rejects2(() => run({ mode: 'rollback', receipt: { manifestSha256: files.manifestSha256, versions: [{ label: EA, insertedIds: [] }] } }), /rollback refused: attempts already reference/);
  });
});

async function rejects2(fn, matcher) {
  const err = await fn().then(() => null, (e) => e);
  expect(err).toBeInstanceOf(CatalogReconcileError);
  expect(err.message).toMatch(matcher);
}
