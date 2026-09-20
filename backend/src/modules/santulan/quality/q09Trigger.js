/*
 * Q09 safeguarding trigger (BUILD 06 §9, audit B06-AUD-009). The trigger content and the human escalation workflow are NOT
 * frozen, so this fires ONLY for a trigger source listed as approved in the governed policy
 * (detectors.Q09.approvedTriggerSources); with no approved configuration it does nothing. When it fires it records a
 * CRITICAL Q09 flag (the database routes the attempt to QUALITY_HOLD) and calls the P5 hook if one is registered. It never
 * produces a score, never touches responses, and writes no trigger content or participant detail to the audit trail.
 */
const { withSystemTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const { loadPolicy } = require('./policyLoader');

let p5Hook = null;
/** US7 registers the pathway-P5 decision hook here: async (tx, { attemptId, correlationId }) => void. */
const setP5Hook = (fn) => { p5Hook = fn; };

async function fireQ09({ attemptId, triggerSource, correlationId }) {
  let approved = [];
  try {
    const cfg = (loadPolicy().detectors || {}).Q09;
    approved = cfg && Array.isArray(cfg.approvedTriggerSources) ? cfg.approvedTriggerSources : [];
  } catch (err) { approved = []; }
  if (!approved.includes(triggerSource)) return { fired: false, reason: 'NO_APPROVED_TRIGGER' };

  return withSystemTx(async (tx) => {
    const attempt = (await tx.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1 FOR UPDATE', [attemptId])).rows[0];
    if (!attempt) return { fired: false, reason: 'NOT_FOUND' };
    const inserted = await tx.query(`INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, NULL, 'Q09', 'CRITICAL') ON CONFLICT DO NOTHING`, [attemptId]);
    if (inserted.rowCount === 1) {                                                   // a repeat trigger is a no-op: one audit row, one P5 hook call
      await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'Q09_FIRED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { flag: 'Q09' }, correlationId });
      if (p5Hook) await p5Hook(tx, { attemptId, correlationId });
    }
    const after = (await tx.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rows[0];
    return { fired: true, attemptStatus: after.status };
  });
}

module.exports = { fireQ09, setP5Hook };
