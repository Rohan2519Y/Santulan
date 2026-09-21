/*
 * Pathway Engine (BUILD 07 sections 13-16; Development Reporting Master 09_Pathway_Routing), on the store. Records P1-P5 decisions
 * with the guards of domain/pathwayRules.js: precedence P5 > P4 > P3 > P2 > P1; "P0" blocks (no decision is created); a score alone
 * never creates P3 / P4; human-support routes need a human or participant basis and, for a minor, the verified consent / assent;
 * P5 is unconditional.
 */
const { z } = require('zod');
const { HttpError } = require('../../../shared/errors');
const config = require('../../../config');
const store = require('../store');
const delivery = require('../store/repositories/delivery');
const identity = require('../store/repositories/identity');
const consents = require('../store/repositories/consents');
const scoresRepo = require('../store/repositories/scores');
const growth = require('../store/repositories/growth');
const { writeAudit } = require('../audit/auditService');
const { strictObject } = require('../shared/http');
const rules = require('../domain/pathwayRules');
const consentRules = require('../domain/consentRules');
const { PATHWAY_ENGINE_VERSION, firePathwayP5 } = require('./p5Hook');

const CODE = /^[A-Z0-9_-]{2,40}$/;

const decisionSchema = strictObject({
  pathwayCode: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']),
  triggerCode: z.string().trim().toUpperCase().regex(CODE),
  decisionSource: z.enum(['SYSTEM', 'PARTICIPANT', 'HUMAN_REVIEW']),
  decisionReason: z.string().trim().min(3).max(300).optional(),
  domainCode: z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']).optional(),
  subdomainCode: z.string().regex(/^C[1-7]\.\d{1,2}$/).optional(),
});

/** Records one pathway decision for an attempt. Returns { decisionId, pathwayCode, status, effective, created }. */
async function decide(attemptId, body, { correlationId } = {}) {
  return store.withScope(store.systemScope(), async (tx) => {
    const attempt = await delivery.getAttempt(tx, attemptId);
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

    if (body.pathwayCode === 'P5') { // unconditional: no release switch, any attempt state; the hook audits itself
      const decisionId = await firePathwayP5(tx, { attemptId, triggerCode: body.triggerCode, decisionSource: body.decisionSource, correlationId });
      return { decisionId, pathwayCode: 'P5', status: 'S7', effective: 'P5', created: true };
    }

    const participant = await identity.getParticipant(tx, attempt.participantId);
    const gate = consentRules.evaluateGate(participant, await consents.listForParticipant(tx, attempt.participantId));
    const scores = body.domainCode ? await scoresRepo.listForAttempt(tx, attemptId) : [];
    let hasSelectedPriority = false;
    if (body.pathwayCode === 'P1' && body.domainCode) {
      const plan = await growth.getPlanByAttempt(tx, attemptId);
      hasSelectedPriority = !!plan && (await growth.prioritiesOf(tx, plan.planId)).some((p) => p.domainCode === body.domainCode && p.participantSelected);
    }
    const evidenceState = rules.assertOrdinaryAllowed(body, {
      attemptStatus: attempt.status, isMinor: participant.isMinor, gateOpen: gate.open, domainScore: scores.find((s) => s.domainCode === body.domainCode) || null, hasSelectedPriority,
    });

    // precedence: a higher-support decision already governs this attempt
    const existing = (await growth.decisionsOfAttempt(tx, attemptId)).map((d) => d.pathwayCode);
    const governing = rules.effectiveRoute([...existing, body.pathwayCode]);
    if (governing !== body.pathwayCode) return { decisionId: null, pathwayCode: body.pathwayCode, status: null, effective: governing, created: false, superseded: true };

    const inserted = await growth.insertDecision(tx, {
      participantId: attempt.participantId, attemptId, domainCode: body.domainCode || null, pathwayCode: body.pathwayCode, triggerCode: body.triggerCode, evidenceState,
      decisionSource: body.decisionSource, decisionReason: body.decisionReason || 'Pathway candidate recorded.', status: 'S1', policyVersion: config.pathwayPolicyVersion, engineVersion: PATHWAY_ENGINE_VERSION,
    });
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'PATHWAY_DECIDED', targetEntity: 'pathway_decisions', targetId: inserted.decisionId, newState: { pathwayCode: body.pathwayCode, status: 'S1', decisionSource: body.decisionSource }, correlationId });
    return { decisionId: inserted.decisionId, pathwayCode: body.pathwayCode, status: 'S1', effective: governing, created: true };
  }, { transaction: true });
}

module.exports = { decide, decisionSchema, effectiveRoute: rules.effectiveRoute, PRECEDENCE: rules.PRECEDENCE, HELD_SUBDOMAINS: rules.HELD_SUBDOMAINS };
