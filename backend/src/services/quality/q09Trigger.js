/*
 * Q09 safeguarding trigger (BUILD 06 section 9, audit B06-AUD-009), on the store. The trigger content and the human escalation
 * workflow are NOT frozen, so this fires ONLY for a trigger source listed as approved in the governed policy
 * (detectors.Q09.approvedTriggerSources); with no approved configuration it does nothing. When it fires it records a CRITICAL Q09
 * flag once (the attempt is routed to QUALITY_HOLD) and calls the P5 hook if one is registered. It never produces a score, never
 * touches responses, and writes no trigger content or participant detail to the audit trail.
 */
const store = require('../../models/db');
const { writeAudit } = require('../audit/auditService');
const { loadPolicy } = require('./policyLoader');
const { raiseQ09 } = require('../domain/qualityRules');

let p5Hook = null;
/** US8 registers the pathway-P5 decision hook here: async (tx, { attemptId, correlationId }) => void. */
const setP5Hook = (fn) => { p5Hook = fn; };

async function fireQ09({ attemptId, triggerSource, correlationId }) {
  let approved = [];
  try {
    const cfg = (loadPolicy().detectors || {}).Q09;
    approved = cfg && Array.isArray(cfg.approvedTriggerSources) ? cfg.approvedTriggerSources : [];
  } catch (err) { approved = []; }
  if (!approved.includes(triggerSource)) return { fired: false, reason: 'NO_APPROVED_TRIGGER' };

  return store.withScope(store.systemScope(), async (tx) => {
    const r = await raiseQ09(tx, attemptId);
    if (!r.found) return { fired: false, reason: 'NOT_FOUND' };
    if (r.created) { // a repeat trigger is a no-op: one audit row, one P5 hook call
      await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'Q09_FIRED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { flag: 'Q09' }, correlationId });
      if (p5Hook) await p5Hook(tx, { attemptId, correlationId });
    }
    return { fired: true, attemptStatus: r.attemptStatus };
  }, { transaction: true });
}

module.exports = { fireQ09, setP5Hook };
