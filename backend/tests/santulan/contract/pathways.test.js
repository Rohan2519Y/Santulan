/*
 * Pathway Engine API (BUILD 07 sections 13-16: B07-052, 056..065, 071, 080) on MongoDB. Through the real app on the SCRATCH database.
 * Covers precedence P5 > P4 > P3 > P2 > P1, the P0 blocks, the human-support basis, the minor consent gate and the unconditional P5
 * hook - including the Q09 -> P5 wiring that q09Trigger.js uses.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const p = require('../helpers/contractPipeline');
const { effectiveRoute, PRECEDENCE } = require('../../../src/services/pathways/pathwayService');
const config = require('../../../src/config');
const { closeClient } = require('../../../src/models/db/client');

const { f, F, H, P, api, post, get, internal, scoredAttempt, terminalAttempt, generate, growthPlanOf, ZERO_ID } = p;
const decide = (attemptId, body) => internal('post', `/internal/attempts/${attemptId}/pathways`, body);
const req = (pathwayCode, over = {}) => ({ pathwayCode, triggerCode: 'PARTICIPANT_REQUEST', decisionSource: 'PARTICIPANT', ...over });
const decisions = async (attemptId) => (await (await H.admin()).collection('pathway_decisions').find({ source_attempt_id: attemptId }).sort({ pathway_code: 1 }).toArray())
  .map((d) => ({ pathway_code: d.pathway_code, status: d.status, trigger_code: d.trigger_code, decision_source: d.decision_source, evidence_state: d.evidence_state, domain_code: d.domain_code }));
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);
const tmp = [];
const writeTmp = (name, data) => { const file = path.join(os.tmpdir(), `santulan-${f.u()}-${name}`); fs.writeFileSync(file, JSON.stringify(data)); tmp.push(file); return file; };

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { config.qualityPolicyPath = ''; await p.clearRules(); await p.resetSwitches(); });
afterAll(async () => { tmp.splice(0).forEach((x) => fs.rmSync(x, { force: true })); await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('precedence (BUILD 07 section 14, B07-065)', () => {
  test('P5 > P4 > P3 > P2 > P1: the governing route of any set of decisions', () => {
    expect(PRECEDENCE).toEqual(['P5', 'P4', 'P3', 'P2', 'P1']);
    expect(effectiveRoute(['P1', 'P2'])).toBe('P2');
    expect(effectiveRoute(['P2', 'P5', 'P3'])).toBe('P5');
    expect(effectiveRoute(['P1', 'P4', 'P3'])).toBe('P4');
    expect(effectiveRoute([])).toBeNull();
  });

  test('B07-065 a P2 request after P5 is superseded (no decision is created); a lower route recorded earlier stays as history', async () => {
    const a = await scoredAttempt({ s2: true });
    expect((await decide(a.id, req('P2'))).body).toMatchObject({ created: true, effective: 'P2' });
    const fired = await decide(a.id, req('P5', { triggerCode: 'Q09', decisionSource: 'SYSTEM' }));
    expect(fired.body).toMatchObject({ pathwayCode: 'P5', status: 'S7', effective: 'P5', created: true });
    const later = await decide(a.id, req('P3'));
    expect(later.status).toBe(200);
    expect(later.body).toMatchObject({ created: false, superseded: true, effective: 'P5', decisionId: null });
    expect((await decisions(a.id)).map((d) => d.pathway_code)).toEqual(['P2', 'P5']);
  });
});

describe('access and request schema', () => {
  test('internal key or an active super admin only; the request never carries an evidence state, score or participant id', async () => {
    const a = await scoredAttempt({ s2: true });
    const admin = await f.admin();
    const url = `/api/v1/internal/attempts/${a.id}/pathways`;
    expect((await api().post(url).send(req('P2'))).status).toBe(401);
    expect((await api().post(url).set({ Authorization: `Bearer ${a.p.token}` }).send(req('P2'))).status).toBe(403);
    expect((await api().post(url).set({ 'X-Internal-Api-Key': 'wrong' }).send(req('P2'))).status).toBe(403);
    expect((await post(`/internal/attempts/${a.id}/pathways`, admin, req('P2'))).status).toBe(200);
    for (const extra of [{ evidenceState: 'S5' }, { score: 1 }, { participantId: a.p.participantId }, { status: 'S3' }]) {
      const res = await decide(a.id, { ...req('P2'), ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    for (const bad of [{ pathwayCode: 'P0' }, { pathwayCode: 'P6' }, { triggerCode: 'has spaces!' }, { decisionSource: 'ROBOT' }]) expect((await decide(a.id, { ...req('P2'), ...bad })).status).toBe(400);
    expect((await internal('post', '/internal/attempts/not-a-uuid/pathways', req('P2'))).status).toBe(404);
    expect((await internal('post', `/internal/attempts/${ZERO_ID}/pathways`, req('P2'))).status).toBe(404);
  });
});

describe('ordinary routes and the P0 blocks (T01-T03, M08-M11)', () => {
  test('B07-052 a score alone cannot create P3 or P4, and an automated system cannot create them at all', async () => {
    const a = await scoredAttempt({ s2: true });
    for (const code of ['P3', 'P4']) {
      for (const triggerCode of ['SCORE_ONLY', 'LOW_SCORE']) {
        const res = await decide(a.id, req(code, { triggerCode, decisionSource: 'HUMAN_REVIEW' }));
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PATHWAY_NOT_ALLOWED');
      }
      expect((await decide(a.id, req(code, { decisionSource: 'SYSTEM' }))).body.error.code).toBe('PATHWAY_NOT_ALLOWED');
    }
    expect(await decisions(a.id)).toEqual([]);
  });

  test('B07-056 / B07-057 a participant counselling request (P3) and an authorised professional referral (P4) are recorded as S1 candidates', async () => {
    const a = await scoredAttempt({ s2: true });
    expect((await decide(a.id, req('P3'))).body).toMatchObject({ pathwayCode: 'P3', status: 'S1', created: true });
    expect((await decide(a.id, req('P4', { triggerCode: 'AUTHORISED_REFERRAL', decisionSource: 'HUMAN_REVIEW' }))).body).toMatchObject({ pathwayCode: 'P4', status: 'S1', created: true });
    expect((await decide(a.id, req('P4', { triggerCode: 'AUTHORISED_REFERRAL', decisionSource: 'PARTICIPANT' }))).body.error.code).toBe('PATHWAY_NOT_ALLOWED'); // referral needs a professional
    const rows = await decisions(a.id);
    expect(rows.map((d) => [d.pathway_code, d.decision_source, d.evidence_state])).toEqual([['P3', 'PARTICIPANT', 'S0'], ['P4', 'HUMAN_REVIEW', 'S0']]);
  });

  test('B07-062 P1-P4 from a QUALITY_HOLD or INVALID attempt are refused (P0); no decision is created', async () => {
    for (const held of [await terminalAttempt('QUALITY_HOLD'), await terminalAttempt('INVALID'), await terminalAttempt('QUALITY_HOLD', { q09: true })]) {
      for (const code of ['P1', 'P2', 'P3', 'P4']) {
        const res = await decide(held.id, req(code, { decisionSource: code === 'P4' ? 'HUMAN_REVIEW' : 'PARTICIPANT', domainCode: code === 'P1' ? 'C1' : undefined }));
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PATHWAY_NOT_ALLOWED');
      }
      expect(await decisions(held.id)).toEqual([]);
    }
  });

  test('B07-063 a held construct (Self-Worth C4.2, or a domain held as SH), an insufficient or research-only domain routes nowhere automatically', async () => {
    const a = await scoredAttempt({ s2: true, evidence: { C4: 'SH', C2: 'S1' }, value: (it) => (it.domainCode === 'C1' ? null : 3) });
    const subdomain = await decide(a.id, req('P2', { subdomainCode: 'C4.2' }));
    expect(subdomain.status).toBe(422);
    expect((await decide(a.id, req('P2', { subdomainCode: 'C2.10' }))).status).toBe(422);
    for (const domainCode of ['C4', 'C2', 'C1']) { // held (SH), research-only (S1), insufficient (S0)
      const res = await decide(a.id, req('P2', { domainCode }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PATHWAY_NOT_ALLOWED');
    }
    expect(await decisions(a.id)).toEqual([]);
    const ok = await decide(a.id, req('P2', { domainCode: 'C3' })); // a reportable domain is fine; the evidence state is server-derived
    expect(ok.body.created).toBe(true);
    expect((await decisions(a.id))[0]).toMatchObject({ domain_code: 'C3', evidence_state: 'S2' });
  });

  test('P1 needs a participant-selected priority in that domain (M11 -> P0, return to reflection)', async () => {
    await p.approveRules(['C1', 'C2'].map((d) => ({ domain: d, layer: 'PRIORITY', text: `A capability I may want to strengthen (${d}).` })));
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    expect(made.body.state).toBe('REPORT_READY');
    await p.setSwitch('developmentRelease', true);
    const plan = await growthPlanOf(a.id);
    const c1 = (await (await H.admin()).collection('growth_priorities').findOne({ plan_id: plan._id, domain_code: 'C1' }))._id;
    const p1 = req('P1', { triggerCode: 'SELECTED_PRIORITY', decisionSource: 'SYSTEM', domainCode: 'C1' });
    expect((await decide(a.id, p1)).body.error.code).toBe('PATHWAY_NOT_ALLOWED'); // nothing selected yet
    expect((await decide(a.id, { ...p1, domainCode: undefined })).body.error.code).toBe('PATHWAY_NOT_ALLOWED');
    expect((await post(`/growth-plans/${plan._id}/priorities`, a.p, { priorityId: c1, selected: true })).status).toBe(200);
    expect((await decide(a.id, p1)).body).toMatchObject({ pathwayCode: 'P1', status: 'S1', created: true });
    expect((await decide(a.id, { ...p1, domainCode: 'C2' })).body.error.code).toBe('PATHWAY_NOT_ALLOWED'); // C2 was not selected
  });

  test('B07-071 a minor\'s human-support handoff is blocked until the verified consent / assent is in place', async () => {
    const a = await scoredAttempt({ s2: true });
    await (await H.admin()).collection('consents').updateMany({ participant_id: a.p.participantId }, { $set: { status: 'WITHDRAWN', withdrawn_at: new Date() } });
    for (const code of ['P3', 'P4']) {
      const res = await decide(a.id, req(code, { triggerCode: 'AUTHORISED_REFERRAL', decisionSource: 'HUMAN_REVIEW' }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PATHWAY_NOT_ALLOWED');
    }
    expect((await decide(a.id, req('P2'))).body.created).toBe(true); // structured development is not a human-support handoff
    expect((await decisions(a.id)).map((d) => d.pathway_code)).toEqual(['P2']);
  });
});

describe('the unconditional P5 hook (BUILD 07 section 15, B07-058..061, 080)', () => {
  test('B07-058 / B07-059 an authorised trigger fires P5 / S7 with every prescriptive layer unreleased; a repeat is idempotent', async () => {
    const a = await scoredAttempt({ s2: true });
    const first = await decide(a.id, req('P5', { triggerCode: 'CRISIS', decisionSource: 'HUMAN_REVIEW' }));
    expect(first.body).toMatchObject({ pathwayCode: 'P5', status: 'S7', created: true });
    const again = await decide(a.id, req('P5', { triggerCode: 'crisis', decisionSource: 'HUMAN_REVIEW' }));
    expect(again.body.decisionId).toBe(first.body.decisionId);
    expect(await decisions(a.id)).toEqual([{ pathway_code: 'P5', status: 'S7', trigger_code: 'CRISIS', decision_source: 'HUMAN_REVIEW', evidence_state: 'S0', domain_code: null }]);
    expect(await count('audit_logs', { action_type: 'P5_FIRED', target_id: first.body.decisionId })).toBe(1);
  });

  test('B07-061 P5 from a trigger that is not Q09, safeguarding or crisis is refused', async () => {
    const a = await scoredAttempt({ s2: true });
    for (const triggerCode of ['LOW_SCORE', 'SCORE_ONLY', 'PARTICIPANT_REQUEST', 'SELECTED_PRIORITY']) {
      const res = await decide(a.id, req('P5', { triggerCode }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PATHWAY_NOT_ALLOWED');
    }
    expect(await decisions(a.id)).toEqual([]);
  });

  test('B07-080 P5 fires for a held attempt whose report is UNDER_REVIEW, and the participant\'s report view reveals nothing', async () => {
    const held = await terminalAttempt('QUALITY_HOLD', { q09: true });
    const made = await generate(held.id);
    expect(made.body.state).toBe('UNDER_REVIEW');
    const fired = await decide(held.id, req('P5', { triggerCode: 'Q09', decisionSource: 'SYSTEM' }));
    expect(fired.body).toMatchObject({ status: 'S7', created: true });
    const shown = await get(`/reports/${made.body.reportId}`, held.p);
    expect(shown.body.state).toBe('UNDER_REVIEW');
    expect(shown.body.sections).toEqual([{ type: 'UNDER_REVIEW', locale: 'en', contentVersion: 't11-v1', order: 1, content: 'Your responses are being reviewed.' }]);
    expect(await count('pathway_decisions', { _id: fired.body.decisionId })).toBe(1); // stored for the human workflow
  });

  test('B07-058 the Q09 trigger route wires into P5: an approved safeguarding source records the flag, holds the attempt and fires P5 once', async () => {
    const a = await scoredAttempt({ s2: true });
    config.qualityPolicyPath = writeTmp('policy-q09.json', { version: 'test-q09', detectors: { Q09: { approvedTriggerSources: ['TEST_SOURCE'] } } });
    const unapproved = await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'OTHER_SOURCE' });
    expect(unapproved.body).toMatchObject({ fired: false });
    expect(await decisions(a.id)).toEqual([]);
    const fired = await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' });
    expect(fired.body).toMatchObject({ fired: true, attemptStatus: 'QUALITY_HOLD' });
    await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' }); // repeat trigger: no second P5
    expect(await decisions(a.id)).toEqual([{ pathway_code: 'P5', status: 'S7', trigger_code: 'Q09', decision_source: 'SYSTEM', evidence_state: 'S0', domain_code: null }]);
    const model = await get(`/attempts/${a.id}`, a.p);
    expect(JSON.stringify(model.body)).not.toMatch(/P5|Q09|safeguard|crisis|escalat/i); // nothing leaks to the participant
  });

  test('B07-060 P5 pauses only ACTIVE growth plans of the participant', async () => {
    const a = await scoredAttempt({ s2: true });
    const attempt = await P.attemptOf(a.id);
    const db = await H.admin();
    const plans = [];
    for (const status of ['ACTIVE', 'DRAFT', 'COMPLETED']) {
      const doc = F.growthPlan(attempt.participant_id, a.id, attempt.assessment_version_id, { _id: uuidv4(), status, growth_plan_version: 'growth-plan-test' });
      await db.collection('growth_plans').insertOne(doc);
      plans.push(doc._id);
    }
    await decide(a.id, req('P5', { triggerCode: 'SAFEGUARDING', decisionSource: 'HUMAN_REVIEW' }));
    const after = Object.fromEntries((await db.collection('growth_plans').find({ _id: { $in: plans } }).toArray()).map((r) => [r._id, r.status]));
    expect(plans.map((x) => after[x])).toEqual(['PAUSED', 'DRAFT', 'COMPLETED']);
  });
});
