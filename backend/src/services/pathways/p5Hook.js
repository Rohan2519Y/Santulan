/*
 * The P5 (safeguarding / crisis) hook (BUILD 07 section 15, audit B07-AUD-005), on the store. It records one idempotent P5 / S7
 * ESCALATED decision, pauses the participant's ACTIVE growth plans and audits - and deliberately consults NO release switch.
 * It does not define what a Q09 trigger is (that stays an upstream safeguarding-policy approval, B06-AUD-009 / B07-AUD-010); it
 * only guarantees what happens downstream once an authorised trigger fires. q09Trigger.js calls it inside the same transaction that
 * records the Q09 flag.
 */
const config = require('../../config');
const { HttpError } = require('../../errors');
const delivery = require('../../models/repositories/delivery');
const growth = require('../../models/repositories/growth');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/pathwayRules');
const { setP5Hook } = require('../quality/q09Trigger');

const PATHWAY_ENGINE_VERSION = 'pathway-engine-v1'; // ASSUMED label (D-11): BUILD 01 states only text NOT NULL

/** Fires P5 inside the caller's SYSTEM transaction. Returns the decision id. */
async function firePathwayP5(tx, { attemptId, triggerCode = 'Q09', decisionSource = 'SYSTEM', correlationId = null }) {
  const trigger = String(triggerCode || '').trim().toUpperCase();
  rules.assertP5Trigger(trigger);
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

  const prior = (await growth.decisionsOfAttempt(tx, attemptId)).find((d) => d.pathwayCode === 'P5' && String(d.triggerCode).toUpperCase() === trigger);
  if (prior) return prior.decisionId; // idempotent: one decision, one pause, one audit row

  const decision = await growth.insertDecision(tx, {
    participantId: attempt.participantId, attemptId, domainCode: null, pathwayCode: 'P5', triggerCode: trigger, evidenceState: 'S0', decisionSource,
    decisionReason: 'Safeguarding / crisis trigger recorded; protected urgent workflow.', status: 'S7', policyVersion: config.pathwayPolicyVersion, engineVersion: PATHWAY_ENGINE_VERSION,
  });
  let paused = 0;
  for (const plan of await growth.activePlansOf(tx, attempt.participantId)) {
    if (await growth.movePlan(tx, plan.planId, 'ACTIVE', 'PAUSED')) paused += 1;
  }
  await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'P5_FIRED', targetEntity: 'pathway_decisions', targetId: decision.decisionId, newState: { attempt_id: attemptId, trigger_code: trigger, growth_plans_paused: paused }, correlationId });
  return decision.decisionId;
}

/** Registers the Q09 -> P5 wiring (US6 left the hook point open). */
const registerP5Hook = () => setP5Hook((tx, { attemptId, correlationId }) => firePathwayP5(tx, { attemptId, triggerCode: 'Q09', correlationId }));

module.exports = { firePathwayP5, registerP5Hook, PATHWAY_ENGINE_VERSION };
