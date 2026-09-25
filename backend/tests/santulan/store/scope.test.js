/* Scoped data-access layer (G-21..G-26; SEC-01..SEC-11). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');
const store = require('../../../src/models/db');
const { closeClient } = require('../../../src/models/db/client');

const fx = H.withFixtures('scope');
afterAll(async () => { await fx.cleanup(); await closeClient(); await H.closeAll(); });

let W;
beforeAll(async () => {
  const instA = await fx.insertAdmin('institutions', F.institution());
  const instB = await fx.insertAdmin('institutions', F.institution());
  const cohA = await fx.insertAdmin('cohorts', F.cohort(instA._id));
  const cohB = await fx.insertAdmin('cohorts', F.cohort(instB._id));
  const inst = (i, c) => F.participant({ participation_route: 'INSTITUTIONAL', institution_id: i._id, cohort_id: c._id });
  const pA = await fx.insertAdmin('participants', inst(instA, cohA));
  const pB = await fx.insertAdmin('participants', inst(instB, cohB));
  const pOpen = await fx.insertAdmin('participants', F.participant());
  const set = await fx.insertAdmin('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date() }));
  const it = await fx.insertAdmin('items', F.item(set._id));
  const mkAttempt = (p) => fx.insertAdmin('assessment_attempts', F.attempt(p._id, set._id, { status: 'IN_PROGRESS' }));
  const aA = await mkAttempt(pA);
  const aB = await mkAttempt(pB);
  const aO = await mkAttempt(pOpen);
  const rA = await fx.insertAdmin('responses', F.response(aA._id, it._id));
  const rB = await fx.insertAdmin('responses', F.response(aB._id, it._id));
  const repA = await fx.insertAdmin('reports', F.report(pA._id, aA._id, { generation_status: 'REPORT_READY', content_hash: F.hex('a') }));
  const secA1 = await fx.insertAdmin('report_sections', F.reportSection(repA._id, { display_order: 1, is_released_to_participant: true }));
  const secA2 = await fx.insertAdmin('report_sections', F.reportSection(repA._id, { display_order: 2, section_type: 'PRIORITY', is_released_to_participant: false }));
  await fx.insertAdmin('score_results', F.score(aA._id, pA._id, set._id));
  await fx.insertAdmin('quality_flags', F.qualityFlag(aA._id));
  await fx.insertAdmin('consents', F.verifiedConsent(pA._id));
  await fx.insertAdmin('consents', F.verifiedConsent(pB._id));
  const adm = await fx.insertAdmin('admin_users', F.admin());
  await fx.insertAdmin('research_exports', F.researchExport(adm._id, set._id));
  W = { instA, instB, cohA, cohB, pA, pB, pOpen, set, it, aA, aB, aO, rA, rB, repA, secA1, secA2, adm };
});

const part = (p) => store.participantScope(p._id);
const instScope = (i) => store.institutionScope(i._id);
const read = (scope, fn) => store.withScope(scope, fn);

describe('G-21 no scope, no data', () => {
  test('SEC-10 NO_SCOPE reads return nothing and writes are refused', async () => {
    await read(store.NO_SCOPE, async (tx) => {
      expect(await tx.c.participants.find({})).toEqual([]);
      expect(await tx.c.assessment_versions.find({})).toEqual([]);
      expect(await tx.c.participants.count({})).toBe(0);
      await expect(tx.c.institutions.insertOne(F.institution())).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.participants.updateOne({ _id: W.pA._id }, { $set: { status: 'SUSPENDED' } })).rejects.toMatchObject({ status: 403 });
    });
  });

  test('SEC-10 a hand-made scope object is not a scope', async () => {
    const fake = { actorScope: 'SUPER_ADMIN', participantId: null, adminUserId: null, institutionId: null };
    await read(fake, async (tx) => {
      expect(await tx.c.participants.find({})).toEqual([]);
      await expect(tx.c.institutions.insertOne(F.institution())).rejects.toMatchObject({ status: 403 });
    });
  });

  test('SEC-10 buildScope returns NO_SCOPE for anything it does not recognise', () => {
    expect(store.buildScope(null)).toBe(store.NO_SCOPE);
    expect(store.buildScope({ role: 'participant', participantId: 'not-a-uuid' })).toBe(store.NO_SCOPE);
    expect(store.buildScope({ role: 'admin', adminUserId: W.adm._id })).toBe(store.NO_SCOPE); // no admin row loaded
    expect(store.buildScope({ role: 'admin', adminUserId: W.adm._id }, { role: 'SUPER_ADMIN', status: 'SUSPENDED' })).toBe(store.NO_SCOPE);
    expect(store.buildScope({ role: 'admin', adminUserId: W.adm._id }, { role: 'INSTITUTION_ADMIN', status: 'ACTIVE', institutionId: null })).toBe(store.NO_SCOPE);
    expect(store.buildScope({ role: 'root' })).toBe(store.NO_SCOPE);
  });
});

describe('G-22 a participant sees only their own data', () => {
  test('SEC-04 own attempts, answers, consents, reports', async () => {
    await read(part(W.pA), async (tx) => {
      expect((await tx.c.participants.find({})).map((p) => p._id)).toEqual([W.pA._id]);
      expect((await tx.c.assessment_attempts.find({})).map((a) => a._id)).toEqual([W.aA._id]);
      expect((await tx.c.responses.find({ attempt_id: W.aA._id })).map((r) => r._id)).toEqual([W.rA._id]);
      expect((await tx.c.consents.find({})).every((c) => c.participant_id === W.pA._id)).toBe(true);
      expect((await tx.c.reports.find({})).map((r) => r._id)).toEqual([W.repA._id]);
    });
  });

  test('SEC-05 another participant\'s ids return nothing', async () => {
    await read(part(W.pA), async (tx) => {
      expect(await tx.c.assessment_attempts.findOne({ _id: W.aB._id })).toBeNull();
      expect(await tx.c.participants.findOne({ _id: W.pB._id })).toBeNull();
      expect(await tx.c.responses.find({ attempt_id: W.aB._id })).toEqual([]);
      expect(await tx.c.reports.find({ participant_id: W.pB._id })).toEqual([]);
      expect(await tx.c.responses.find({})).toEqual([]); // a child read must pin its parent
      expect(await tx.c.responses.find({ attempt_id: { $in: [W.aA._id, W.aB._id] } })).toEqual([]); // one foreign parent poisons the set
    });
  });

  test('SEC-05 a participant cannot write into another participant\'s data', async () => {
    await read(part(W.pA), async (tx) => {
      await expect(tx.c.assessment_attempts.insertOne(F.attempt(W.pB._id, W.set._id))).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.responses.insertOne(F.response(W.aB._id, W.it._id))).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.participants.updateOne({ _id: W.pB._id }, { $set: { status: 'SUSPENDED' } })).resolves.toEqual({ matched: 0, modified: 0 });
    });
  });

  test('G-22 a participant sees only released report sections', async () => {
    await read(part(W.pA), async (tx) => {
      const rows = await tx.c.report_sections.find({ report_id: W.repA._id });
      expect(rows.map((r) => r._id)).toEqual([W.secA1._id]);
    });
    await read(store.systemScope(), async (tx) => {
      expect(await tx.c.report_sections.find({ report_id: W.repA._id })).toHaveLength(2);
    });
  });
});

describe('G-23 privileged collections are closed to participants', () => {
  test('SEC-06 admin_users, research_exports, audit_logs, quality_flags, score_results, interpretation rules', async () => {
    await read(part(W.pA), async (tx) => {
      for (const name of ['admin_users', 'research_exports', 'audit_logs', 'quality_flags', 'score_results', 'interpretation_rules', 'development_actions', 'dev_identity_credentials']) {
        expect(await tx.c[name].find({})).toEqual([]);
        expect(await tx.c[name].count({})).toBe(0);
      }
      await expect(tx.c.admin_users.insertOne(F.admin())).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.research_exports.insertOne(F.researchExport(W.adm._id, W.set._id))).rejects.toMatchObject({ status: 403 });
    });
  });

  test('SEC-06 engine-owned rows (reports, sections, growth plans and candidates, pathways) are readable by their owner but never insertable by a participant', async () => {
    await read(part(W.pA), async (tx) => {
      const forged = [
        ['reports', F.report(W.pA._id, W.aA._id, { attempt_id: W.aA._id })],
        ['report_sections', F.reportSection(W.repA._id)],
        ['growth_plans', F.growthPlan(W.pA._id, W.aA._id, W.set._id)],
        ['growth_priorities', { _id: 'fx-forged-priority', plan_id: 'fx-plan', domain_code: 'C1', candidate_rank: 1, participant_selected: true, priority_text: 'x', created_at: new Date() }],
        ['pathway_decisions', F.pathwayDecision(W.pA._id, W.aA._id)],
      ];
      for (const [name, doc] of forged) await expect(tx.c[name].insertOne(doc)).rejects.toMatchObject({ status: 403 });
    });
    await read(store.systemScope(), async (tx) => {
      expect(await tx.c.report_sections.count({ content_version: 'fx-1', report_id: { $ne: W.repA._id } })).toBe(0);
    });
  });

  test('SEC-06 any valid scope may append an audit row but never read it', async () => {
    const audit = F.audit();
    fx.track('audit_logs', audit._id);
    await read(part(W.pA), async (tx) => {
      await tx.c.audit_logs.insertOne(audit);
      expect(await tx.c.audit_logs.find({ _id: audit._id })).toEqual([]);
    });
    await read(store.systemScope(), async (tx) => { expect(await tx.c.audit_logs.exists(audit._id)).toBe(true); });
  });

  test('SEC-07 a super admin sees everything', async () => {
    await read(store.superAdminScope(W.adm._id), async (tx) => {
      expect((await tx.c.participants.find({ _id: { $in: [W.pA._id, W.pB._id, W.pOpen._id] } }))).toHaveLength(3);
      expect(await tx.c.research_exports.count({})).toBeGreaterThan(0);
      expect(await tx.c.score_results.count({ attempt_id: W.aA._id })).toBe(1);
    });
  });
});

describe('G-24 institution scope is an exact, non-null match', () => {
  test('SEC-01 institution A sees only A\'s participants, cohorts and their derived data', async () => {
    await read(instScope(W.instA), async (tx) => {
      expect((await tx.c.participants.find({ _id: { $in: [W.pA._id, W.pB._id, W.pOpen._id] } })).map((p) => p._id)).toEqual([W.pA._id]);
      expect((await tx.c.cohorts.find({})).every((c) => c.institution_id === W.instA._id)).toBe(true);
      expect((await tx.c.institutions.find({})).map((i) => i._id)).toEqual([W.instA._id]);
      expect((await tx.c.assessment_attempts.find({ _id: { $in: [W.aA._id, W.aB._id, W.aO._id] } })).map((a) => a._id)).toEqual([W.aA._id]);
      expect(await tx.c.responses.find({ attempt_id: W.aB._id })).toEqual([]);
      expect((await tx.c.responses.find({ attempt_id: W.aA._id })).map((r) => r._id)).toEqual([W.rA._id]);
    });
  });

  test('SEC-02 institution scope cannot reach another institution by id', async () => {
    await read(instScope(W.instA), async (tx) => {
      expect(await tx.c.participants.findOne({ _id: W.pB._id })).toBeNull();
      expect(await tx.c.institutions.findOne({ _id: W.instB._id })).toBeNull();
    });
  });

  test('SEC-03 OPEN participants (null institution) are never matched by an institution scope', async () => {
    await read(instScope(W.instA), async (tx) => {
      expect(await tx.c.participants.findOne({ _id: W.pOpen._id })).toBeNull();
      expect(await tx.c.assessment_attempts.findOne({ _id: W.aO._id })).toBeNull();
    });
    // a scope with a null institution id is not a scope at all
    await read(store.institutionScope(null), async (tx) => { expect(await tx.c.participants.find({})).toEqual([]); });
  });

  test('G-24 an institution scope cannot write and cannot read privileged collections', async () => {
    await read(instScope(W.instA), async (tx) => {
      await expect(tx.c.participants.insertOne(F.participant())).rejects.toMatchObject({ status: 403 });
      expect(await tx.c.admin_users.find({})).toEqual([]);
      expect(await tx.c.audit_logs.find({})).toEqual([]);
    });
  });
});

describe('G-25 scope values come only from the verified session', () => {
  test('SEC-08 scope fields in a filter or body do not widen access', async () => {
    await read(part(W.pA), async (tx) => {
      expect(await tx.c.participants.find({ _id: W.pB._id, institution_id: W.instB._id })).toEqual([]);
      expect(await tx.c.assessment_attempts.find({ participant_id: W.pB._id })).toEqual([]);
      expect(await tx.c.assessment_attempts.find({ $or: [{ participant_id: W.pB._id }, { participant_id: W.pA._id }] })).toHaveLength(1);
    });
  });

  test('SEC-08 buildScope reads only the verified user object', () => {
    const s = store.buildScope({ role: 'participant', participantId: W.pA._id, institutionId: W.instB._id, actorScope: 'SUPER_ADMIN' });
    expect(s.actorScope).toBe('PARTICIPANT');
    expect(s.institutionId).toBeNull();
  });

  test('SEC-09 a worker acts only with an explicit SYSTEM scope', async () => {
    expect(store.systemScope().actorScope).toBe('SYSTEM');
    await read(store.systemScope(), async (tx) => { expect(await tx.c.participants.exists(W.pA._id)).toBe(true); });
  });
});

describe('G-26 scope is request-scoped', () => {
  test('SEC-11 two interleaved requests never see each other\'s scope', async () => {
    const work = async (p, other) => read(part(p), async (tx) => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      const mine = await tx.c.assessment_attempts.find({});
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      const foreign = await tx.c.assessment_attempts.findOne({ participant_id: other._id });
      return { mine: mine.map((a) => a.participant_id), foreign };
    });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? work(W.pA, W.pB) : work(W.pB, W.pA))));
    results.forEach((r, i) => {
      expect(r.foreign).toBeNull();
      expect(r.mine).toEqual([i % 2 ? W.pA._id : W.pB._id]);
    });
  });
});

describe('Tier B updates are limited to named fields', () => {
  test('G-13 fields outside the named mutation, other operators and Tier A collections are refused', async () => {
    await read(store.systemScope(), async (tx) => {
      await expect(tx.c.participants.updateOne({ _id: W.pA._id }, { $set: { age_years_at_registration: 20 } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.participants.updateOne({ _id: W.pA._id }, { $unset: { status: '' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.audit_logs.updateOne({}, { $set: { reason: 'x' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.items.updateOne({ _id: W.it._id }, { $set: { item_text: 'changed' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.score_results.updateOne({}, { $set: { raw_score: 5 } })).rejects.toMatchObject({ status: 403 });
      expect(tx.c.participants.remove).toBeUndefined();
      expect(tx.c.participants.deleteOne).toBeUndefined();
    });
  });
});
