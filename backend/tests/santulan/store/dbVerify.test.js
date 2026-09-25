/* scripts/db-verify.js: passes on a clean database and fails on each kind of drift (T023). Mutates and always restores the scratch DB. */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');
const { verify } = require('../../../scripts/db-verify');
const canonical = require('../../../src/services/questionsets/canonical');
const { fingerprint } = require('../../../src/services/domain/fingerprint');
const { collections } = require('../../../src/models/schema');

const fx = H.withFixtures('verify');
afterAll(async () => { await fx.cleanup(); await H.closeAll(); });

const checks = (r) => r.failures.map((f) => f.check);

describe('db-verify', () => {
  test('G-01 passes on a clean scratch database', async () => {
    const r = await verify(await H.admin());
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('G-01 fails when a validator is dropped, and passes again once restored', async () => {
    const db = await H.admin();
    const def = collections.find((c) => c.name === 'institutions');
    await db.command({ collMod: 'institutions', validator: {}, validationLevel: 'off' });
    try {
      const r = await verify(db);
      expect(r.ok).toBe(false);
      expect(checks(r)).toContain('validator');
    } finally {
      await db.command({ collMod: 'institutions', validator: def.validator, validationLevel: 'strict', validationAction: 'error' });
    }
    expect((await verify(db)).ok).toBe(true);
  });

  test('G-08 fails when an index is missing', async () => {
    const db = await H.admin();
    await db.collection('consents').dropIndex('idx_consents_participant_status');
    try {
      const r = await verify(db);
      expect(r.ok).toBe(false);
      expect(r.failures.some((f) => f.check === 'index' && f.detail.includes('idx_consents_participant_status'))).toBe(true);
    } finally {
      await db.collection('consents').createIndex({ participant_id: 1, status: 1 }, { name: 'idx_consents_participant_status' });
    }
    expect((await verify(db)).ok).toBe(true);
  });

  test('T-B02-011 fails when a frozen set no longer matches its content_hash', async () => {
    const set = await fx.insertAdmin('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date(), content_hash: F.hex('wrong') }));
    await fx.insertAdmin('items', F.item(set._id));
    await fx.insertAdmin('audit_logs', F.audit({ action_type: 'QUESTION_SET_FROZEN', target_entity: 'assessment_version', target_id: set._id }));
    const bad = await verify(await H.admin());
    expect(bad.failures.some((f) => f.check === 'frozen-hash' && f.detail.includes(set.version_label))).toBe(true);
    const db = await H.admin();
    const items = await db.collection('items').find({ assessment_version_id: set._id }).toArray();
    await db.collection('assessment_versions').updateOne({ _id: set._id }, { $set: { content_hash: canonical.contentHash(items) } });
    expect(checks(await verify(db))).not.toContain('frozen-hash');
  });

  test('G-29 fails when a terminal report hash no longer matches its sections', async () => {
    const pid = F.participant()._id;
    const aid = F.attempt(pid, F.versionDoc()._id)._id;
    const rep = await fx.insertAdmin('reports', F.report(pid, aid, { generation_status: 'REPORT_READY', generated_at: new Date(), content_hash: F.hex('nope') }));
    const sec = await fx.insertAdmin('report_sections', F.reportSection(rep._id, { display_order: 1, content_snapshot: '{"a":1}' }));
    // the attempt row does not exist either: provenance also reports it, which is expected here
    expect((await verify(await H.admin())).failures.some((f) => f.check === 'report-hash')).toBe(true);
    const db = await H.admin();
    await db.collection('reports').updateOne({ _id: rep._id }, { $set: { content_hash: fingerprint([sec]) } });
    expect(checks(await verify(db))).not.toContain('report-hash');
  });

  test('G-28 fails when two APPROVED wordings share a dimension (index temporarily absent)', async () => {
    const db = await H.admin();
    const vid = (await fx.insertAdmin('assessment_versions', F.versionDoc()))._id;
    await db.collection('interpretation_rules').dropIndex('uq_one_approved_rule_per_dimension');
    try {
      const dim = { domain_code: 'C3', evidence_state: 'S2', locale: 'en', layer: 'MEANING', developmental_band: null, status: 'APPROVED' };
      await fx.insertAdmin('interpretation_rules', F.rule(vid, dim));
      await fx.insertAdmin('interpretation_rules', F.rule(vid, dim));
      expect(checks(await verify(db))).toContain('wording');
    } finally {
      await fx.cleanup();
      await db.collection('interpretation_rules').createIndex(
        { assessment_version_id: 1, domain_code: 1, developmental_band: 1, evidence_state: 1, locale: 1, layer: 1 },
        { name: 'uq_one_approved_rule_per_dimension', unique: true, partialFilterExpression: { status: 'APPROVED' } },
      );
    }
  });

  test('B05-060 fails when an attempt/question has two current answers (index temporarily absent)', async () => {
    const db = await H.admin();
    const aid = F.attempt(F.participant()._id, F.versionDoc()._id)._id;
    const iid = F.item(F.versionDoc()._id)._id;
    await db.collection('responses').dropIndex('uq_current_response');
    try {
      await fx.insertAdmin('responses', F.response(aid, iid, { response_version: 1, is_current: true }));
      await fx.insertAdmin('responses', F.response(aid, iid, { response_version: 2, is_current: true }));
      expect(checks(await verify(db))).toContain('current-answer');
    } finally {
      await fx.cleanup();
      await db.collection('responses').createIndex({ attempt_id: 1, item_id: 1 }, { name: 'uq_current_response', unique: true, partialFilterExpression: { is_current: true } });
    }
  });

  test('B06-019 fails when a score belongs to another participant than its attempt', async () => {
    const db = await H.admin();
    const set = await fx.insertAdmin('assessment_versions', F.versionDoc());
    const p1 = await fx.insertAdmin('participants', F.participant());
    const p2 = await fx.insertAdmin('participants', F.participant());
    const att = await fx.insertAdmin('assessment_attempts', F.attempt(p1._id, set._id, { status: 'SCORED' }));
    await fx.insertAdmin('score_results', F.score(att._id, p2._id, set._id));
    expect(checks(await verify(db))).toContain('provenance');
    await fx.cleanup();
    expect((await verify(db)).ok).toBe(true);
  });
});
