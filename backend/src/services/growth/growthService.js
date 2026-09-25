/*
 * Growth Plan Engine (BUILD 07 sections 11-12; Development Reporting Master 08_Growth_Plan_Engine), on the store. Built and tested
 * now, participant-visible only after the prescriptive release: every participant route answers 404 until the developmentRelease
 * switch is ON and a PRIORITY section exists on the plan's report. Generation is server-side and only ever uses approved content.
 *
 *   PG-01/02  candidates come from reportable (S2-S5) domains that have an APPROVED PRIORITY rule - never free text, never a held domain
 *   PG-03/04  at most one candidate per domain, ranked by the configurable research-stage index (rankingConfig)
 *   PG-05     up to three candidates; the participant selects, rejects or replaces (at most three are ever selected)
 *   PG-06/09  a goal is one observable behaviour with an editable If-Then; trait goals ("be confident") are refused
 *   PG-10     reviews are unscored and score-free
 * The rules are in domain/growthRules.js; generation runs in its own transaction and can never fail the report.
 */
const { z } = require('zod');
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const delivery = require('../../models/repositories/delivery');
const scoresRepo = require('../../models/repositories/scores');
const reportsRepo = require('../../models/repositories/reports');
const content = require('../../models/repositories/content');
const growth = require('../../models/repositories/growth');
const { writeAudit } = require('../audit/auditService');
const { strictObject } = require('../../middleware/http');
const rules = require('../domain/growthRules');
const reportRules = require('../domain/reportRules');
const releaseFlags = require('../domain/releaseFlags');
const { REPORTABLE_STATES } = require('../reporting/domains');
const { rankCandidates, loadRanking } = require('./rankingConfig');

const PLAN_VERSION = 'growth-plan-v1'; // ASSUMED label (D-11): BUILD 01 states only text NOT NULL
const MAX_CANDIDATES = 3;

// ------------------------------------------------------------------------------------------------ request schemas
const priorityUpdateSchema = strictObject({
  priorityId: z.string().uuid(),
  selected: z.boolean().optional(),
  priorityText: z.string().trim().min(3).max(300).optional(),
  replaceWithPriorityId: z.string().uuid().optional(),
}).refine((b) => b.selected !== undefined || b.priorityText !== undefined || b.replaceWithPriorityId !== undefined, { message: 'nothing to change' });

const goalSchema = strictObject({
  priorityId: z.string().uuid(),
  goalText: z.string().trim().min(8).max(300),
  cue: z.string().trim().min(3).max(200),
  response: z.string().trim().min(3).max(300),
  fallbackAction: z.string().trim().min(3).max(300).optional(),
  frequency: z.string().trim().min(2).max(100).optional(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: strictObject({ code: z.string().min(3).max(32), version: z.string().min(1).max(32), text: z.string().trim().min(3).max(500).optional() }).optional(),
});

const reviewSchema = strictObject({
  goalId: z.string().uuid(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  whatHappened: z.string().trim().max(1000).optional(),
  barrier: z.string().trim().max(500).optional(),
  learning: z.string().trim().max(500).optional(),
  adjustment: z.string().trim().max(500).optional(),
  evidenceNote: z.string().trim().max(500).optional(),
  nextStep: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------------------------------------------ generation (server-side, hidden)
/** Creates the plan (DRAFT) and up to three ranked candidates for a scored attempt. Idempotent per attempt; never fabricates content. */
async function generatePlanInTx(tx, attemptId, { correlationId } = {}) {
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (!['SCORED', 'REPORT_READY'].includes(attempt.status)) throw rules.notEligible('A growth plan comes only from a scored attempt');
  const existing = await growth.getPlanByAttempt(tx, attemptId);
  if (existing) return { planId: existing.planId, created: false };

  const scores = await scoresRepo.listForAttempt(tx, attemptId);
  const approved = await content.approvedRules(tx, attempt.assessmentVersionId);
  const candidates = [];
  for (const s of scores) {
    if (!rules.isEligibleDomain(attempt.status, s)) continue; // PG-01
    const rule = reportRules.pickWording(approved, { layer: 'PRIORITY', domain: s.domainCode, state: s.scoreStatus, band: attempt.developmentalBandAtAttempt });
    if (!rule) continue; // PG-02: approved content only
    candidates.push({ domain: s.domainCode, score: s.rawScore, completeness: s.completenessRate, state: s.scoreStatus, text: rule.approvedTextTemplate });
  }
  const ranked = rankCandidates(candidates).slice(0, MAX_CANDIDATES);
  if (!ranked.length) return { planId: null, created: false };

  const plan = await growth.insertPlan(tx, { attemptId, participantId: attempt.participantId, assessmentVersionId: attempt.assessmentVersionId, version: PLAN_VERSION });
  await growth.insertPriorities(tx, plan.planId, ranked);
  const ranking = loadRanking();
  await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'GROWTH_PLAN_GENERATED', targetEntity: 'growth_plans', targetId: plan.planId, newState: { candidates: ranked.length, rankingVersion: ranking ? ranking.version : 'neutral-domain-order' }, correlationId });
  return { planId: plan.planId, created: true, candidates: ranked.length };
}

const inSystemTx = (fn) => store.withScope(store.systemScope(), fn, { transaction: true });

const generatePlan = (attemptId, opts) => inSystemTx((tx) => generatePlanInTx(tx, attemptId, opts));

/**
 * Generation after a completed report: its own transaction, so a failure here can never touch the report. A concurrent duplicate
 * (same deterministic plan id) resolves to "already exists"; any other failure is audited.
 */
async function generatePlanSafely(attemptId, { correlationId } = {}) {
  try {
    return await generatePlan(attemptId, { correlationId });
  } catch (err) {
    try {
      await inSystemTx((tx) => writeAudit(tx, { actorType: 'SYSTEM', actionType: 'GROWTH_PLAN_FAILED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { errorCode: /^[A-Z0-9_]{2,32}$/.test(String(err.code || '')) ? err.code : 'GENERATION_FAILED' }, correlationId }));
    } catch (e) { /* the failure record is best effort */ }
    return { planId: null, created: false, failed: true };
  }
}

// ------------------------------------------------------------------------------------------------ participant routes (all behind the release)
const participantTx = (participantId, fn, { write = false } = {}) => store.withScope(store.participantScope(participantId), fn, { transaction: write });

/** The release is data: developmentRelease ON and a PRIORITY section on the plan's report. Until then the plan does not exist for the participant. */
async function assertReleased(plan) {
  const ok = await store.withScope(store.systemScope(), async (sys) => {
    if (!(await releaseFlags.getSwitches(sys)).developmentRelease) return false;
    const report = await reportsRepo.getByAttempt(sys, plan.sourceAttemptId);
    if (!report || report.generationStatus !== 'REPORT_READY') return false;
    return (await sys.c.report_sections.count({ report_id: report.reportId, section_type: 'PRIORITY' })) > 0;
  });
  if (!ok) throw new HttpError(404, 'NOT_FOUND', 'Growth plan not found');
}

async function loadPlan(tx, planId) {
  const plan = await growth.getPlan(tx, planId);
  if (!plan) throw new HttpError(404, 'NOT_FOUND', 'Growth plan not found');
  await assertReleased(plan);
  return plan;
}

const assertEditable = (plan) => {
  if (plan.status === 'PAUSED' || plan.status === 'COMPLETED') throw new HttpError(422, 'INVALID_STATE', 'This plan cannot be changed right now');
};

async function planView(tx, plan) {
  const priorities = await growth.prioritiesOf(tx, plan.planId);
  const goals = await growth.goalsOfPriorities(tx, priorities.map((p) => p.priorityId));
  const view = [];
  for (const p of priorities) {
    const g = goals.find((x) => x.priorityId === p.priorityId);
    let goal = null;
    if (g) {
      const actions = await growth.actionsOfGoal(tx, g.goalId);
      goal = {
        id: g.goalId, goalText: g.goalText, cue: g.cue, response: g.response, fallbackAction: g.fallbackAction, frequency: g.frequency, reviewDate: g.reviewDate, status: g.status,
        actions: actions.map((a) => ({ code: a.actionCode, version: a.actionVersion, text: a.actionText })),
      };
    }
    view.push({ id: p.priorityId, domain: p.domainCode, rank: p.candidateRank, selected: p.participantSelected, text: p.priorityText, goal });
  }
  return { planId: plan.planId, status: plan.status, priorities: view };
}

const getPlan = (participantId, planId) => participantTx(participantId, async (tx) => planView(tx, await loadPlan(tx, planId)));

/** Select / reject (deselect) / edit the wording of / replace a candidate. The ceiling of three is enforced here inside the transaction. */
async function updatePriority(participantId, planId, body) {
  return participantTx(participantId, async (tx) => {
    const plan = await loadPlan(tx, planId);
    assertEditable(plan);
    // every change touches the plan document, so two concurrent selections conflict and serialise (no write skew past the ceiling)
    await growth.touchPlan(tx, planId);
    const priorities = await growth.prioritiesOf(tx, planId);
    const find = (id) => { const p = priorities.find((x) => x.priorityId === id); if (!p) throw new HttpError(404, 'NOT_FOUND', 'Priority not found'); return p; };
    const select = async (id, value) => {
      const p = find(id);
      if (value && !p.participantSelected) rules.assertCanSelect(priorities.filter((x) => x.participantSelected).length);
      await growth.setPriority(tx, planId, id, { participant_selected: value });
      p.participantSelected = value;
    };
    if (body.replaceWithPriorityId) {
      await select(body.priorityId, false);
      await select(body.replaceWithPriorityId, true);
    }
    if (body.selected !== undefined) await select(body.priorityId, body.selected);
    if (body.priorityText !== undefined) { find(body.priorityId); await growth.setPriority(tx, planId, body.priorityId, { priority_text: body.priorityText }); }
    return planView(tx, plan);
  }, { write: true });
}

/** Creates or edits the one goal of a selected priority, its If-Then plan and (optionally) one library action with the participant's wording. */
async function saveGoal(participantId, planId, body) {
  rules.assertObservableGoal(body.goalText);
  return participantTx(participantId, async (tx) => {
    const plan = await loadPlan(tx, planId);
    assertEditable(plan);
    const priority = await growth.getPriority(tx, planId, body.priorityId);
    if (!priority) throw new HttpError(404, 'NOT_FOUND', 'Priority not found');
    rules.assertGoalFromSelected(priority);

    let libraryAction = null;
    if (body.action) {
      libraryAction = await store.withScope(store.systemScope(), (sys) => sys.c.development_actions.findOne({ action_code: body.action.code, library_version: body.action.version }));
      rules.assertActionSelectable(priority.domainCode, libraryAction, body.fallbackAction);
    }

    const existing = await growth.goalOf(tx, priority.priorityId);
    const goal = existing || await growth.insertGoal(tx, priority.priorityId, body);
    if (existing) await growth.updateGoal(tx, existing.goalId, priority.priorityId, body);
    if (libraryAction) {
      const has = (await growth.actionsOfGoal(tx, goal.goalId)).some((a) => a.actionCode === body.action.code && a.actionVersion === body.action.version);
      if (!has) await growth.insertAction(tx, goal.goalId, { code: body.action.code, version: body.action.version, text: body.action.text || libraryAction.action_text });
    }
    if (plan.status === 'DRAFT') await growth.movePlan(tx, planId, 'DRAFT', 'ACTIVE');
    return planView(tx, { ...plan, status: plan.status === 'DRAFT' ? 'ACTIVE' : plan.status });
  }, { write: true });
}

/** An unscored review of a goal (PG-10): what happened, barrier, learning, adjustment - never a number. */
async function addReview(participantId, planId, body) {
  return participantTx(participantId, async (tx) => {
    const plan = await loadPlan(tx, planId);
    assertEditable(plan);
    const priorities = await growth.prioritiesOf(tx, planId);
    const goals = await growth.goalsOfPriorities(tx, priorities.map((p) => p.priorityId));
    if (!goals.some((g) => g.goalId === body.goalId)) throw new HttpError(404, 'NOT_FOUND', 'Goal not found');
    await growth.insertReview(tx, body.goalId, body);
    return planView(tx, plan);
  }, { write: true });
}

module.exports = {
  priorityUpdateSchema, goalSchema, reviewSchema, assertObservableGoal: rules.assertObservableGoal, generatePlan, generatePlanInTx, generatePlanSafely,
  getPlan, updatePriority, saveGoal, addReview, PLAN_VERSION, MAX_CANDIDATES, REPORTABLE_STATES,
};
