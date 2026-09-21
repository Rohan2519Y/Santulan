/*
 * Growth plan collections (growth_plans, growth_priorities, growth_goals, growth_actions, growth_reviews) and pathways
 * (pathway_decisions, pathway_reviews). Reviews and pathway rows are append-only; goals, priorities and plans only change through
 * the named mutations of the access layer. A plan id is deterministic per attempt, so two concurrent generations cannot both insert.
 */
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const { camel } = require('../naming');

const PLAN_NS = '6f0d2c1e-7a3b-4c58-9e1d-2b5a8c4f7d10';
const planIdFor = (attemptId) => uuidv5(`growth-plan:${attemptId}`, PLAN_NS);

const P = (d) => camel(d, 'planId');
const PR = (d) => camel(d, 'priorityId');
const G = (d) => camel(d, 'goalId');
const A = (d) => camel(d, 'actionId');
const D = (d) => camel(d, 'decisionId');

async function getPlan(tx, planId) { return P(await tx.c.growth_plans.findOne({ _id: planId })); }
async function getPlanByAttempt(tx, attemptId) { return P(await tx.c.growth_plans.findOne({ source_attempt_id: attemptId })); }

async function insertPlan(tx, { attemptId, participantId, assessmentVersionId, version }) {
  const now = new Date();
  const doc = { _id: planIdFor(attemptId), participant_id: participantId, source_attempt_id: attemptId, assessment_version_id: assessmentVersionId, growth_plan_version: version, status: 'DRAFT', created_at: now, updated_at: now };
  await tx.c.growth_plans.insertOne(doc);
  return P(doc);
}

/** Compare-and-set on plan status; also bumps updated_at (which serialises concurrent priority selections on the plan document). */
async function movePlan(tx, planId, from, to) { return tx.c.growth_plans.transition(planId, { status: from }, { status: to, updated_at: new Date() }); }
async function touchPlan(tx, planId) { await tx.c.growth_plans.updateOne({ _id: planId }, { $set: { updated_at: new Date() } }); }
async function activePlansOf(tx, participantId) { return (await tx.c.growth_plans.find({ participant_id: participantId, status: 'ACTIVE' })).map(P); }

async function insertPriorities(tx, planId, list) {
  const now = new Date();
  const docs = list.map((c, i) => ({ _id: uuidv4(), plan_id: planId, domain_code: c.domain, candidate_rank: i + 1, participant_selected: false, priority_text: c.text, created_at: now }));
  if (docs.length) await tx.c.growth_priorities.insertMany(docs);
  return docs.map(PR);
}
async function prioritiesOf(tx, planId) {
  const rows = await tx.c.growth_priorities.find({ plan_id: planId });
  return rows.map(PR).sort((a, b) => (a.candidateRank ?? 1e9) - (b.candidateRank ?? 1e9) || (a.domainCode < b.domainCode ? -1 : 1));
}
async function getPriority(tx, planId, priorityId) { return PR(await tx.c.growth_priorities.findOne({ _id: priorityId, plan_id: planId })); }
async function setPriority(tx, planId, priorityId, fields) { return (await tx.c.growth_priorities.updateOne({ _id: priorityId, plan_id: planId }, { $set: fields })).modified >= 0; }

async function goalOf(tx, priorityId) { return G(await tx.c.growth_goals.findOne({ priority_id: priorityId })); }
async function goalsOfPriorities(tx, priorityIds) {
  const out = [];
  for (const id of priorityIds) { const g = await goalOf(tx, id); if (g) out.push(g); }
  return out;
}
async function insertGoal(tx, priorityId, v) {
  const now = new Date();
  const doc = { _id: uuidv4(), priority_id: priorityId, goal_text: v.goalText, cue: v.cue, response: v.response, fallback_action: v.fallbackAction || null, frequency: v.frequency || null, review_date: v.reviewDate || null, status: 'PLANNED', created_at: now, updated_at: now };
  await tx.c.growth_goals.insertOne(doc);
  return G(doc);
}
async function updateGoal(tx, goalId, priorityId, v) {
  await tx.c.growth_goals.updateOne({ _id: goalId, priority_id: priorityId }, { $set: { goal_text: v.goalText, cue: v.cue, response: v.response, fallback_action: v.fallbackAction || null, frequency: v.frequency || null, review_date: v.reviewDate || null, updated_at: new Date() } });
}

async function actionsOfGoal(tx, goalId) { return (await tx.c.growth_actions.find({ goal_id: goalId }, { sort: { created_at: 1 } })).map(A); }
async function insertAction(tx, goalId, { code, version, text }) {
  const doc = { _id: uuidv4(), goal_id: goalId, action_code: code, action_version: version, action_text: text, created_at: new Date() };
  await tx.c.growth_actions.insertOne(doc);
  return A(doc);
}

async function insertReview(tx, goalId, b) {
  const doc = {
    _id: uuidv4(), goal_id: goalId, review_date: b.reviewDate, what_happened: b.whatHappened || null, barrier: b.barrier || null, learning: b.learning || null,
    adjustment: b.adjustment || null, evidence_note: b.evidenceNote || null, next_step: b.nextStep || null, created_at: new Date(),
  };
  await tx.c.growth_reviews.insertOne(doc);
  return doc._id;
}

// ---- pathways
async function decisionsOfAttempt(tx, attemptId) { return (await tx.c.pathway_decisions.find({ source_attempt_id: attemptId })).map(D); }

async function insertDecision(tx, d) {
  const doc = {
    _id: uuidv4(), participant_id: d.participantId, source_attempt_id: d.attemptId, domain_code: d.domainCode || null, pathway_code: d.pathwayCode, trigger_code: d.triggerCode,
    evidence_state: d.evidenceState, decision_source: d.decisionSource, decision_reason: d.decisionReason, status: d.status, created_at: new Date(), review_due: d.reviewDue || null,
    policy_version: d.policyVersion, pathway_engine_version: d.engineVersion,
  };
  await tx.c.pathway_decisions.insertOne(doc);
  return D(doc);
}

module.exports = {
  planIdFor, getPlan, getPlanByAttempt, insertPlan, movePlan, touchPlan, activePlansOf,
  insertPriorities, prioritiesOf, getPriority, setPriority, goalOf, goalsOfPriorities, insertGoal, updateGoal, actionsOfGoal, insertAction, insertReview,
  decisionsOfAttempt, insertDecision,
};
