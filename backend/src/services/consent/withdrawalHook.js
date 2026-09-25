/*
 * Withdrawal workflow hook (BUILD 04 §11). The approved withdrawal / pseudonymisation procedure is unresolved
 * (spec 005 D-05), so the default only records that a withdrawal happened. It MUST NOT delete or rewrite any response:
 * a withdrawn consent closes the gate; treatment of collected data follows the separately approved procedure.
 */
const { writeAudit } = require('../audit/auditService');

const defaultHook = async (tx, { participantId, consentId, correlationId }) => {
  await writeAudit(tx, {
    actorType: 'SYSTEM', actionType: 'CONSENT_WITHDRAWAL_WORKFLOW_PENDING', targetEntity: 'consents', targetId: consentId,
    newState: { note: 'approved withdrawal procedure not configured; no data changed' }, correlationId,
  });
  return { participantId };
};
let hook = defaultHook;

const onWithdrawn = (tx, ctx) => hook(tx, ctx);
/** Replaces the workflow (used when the approved procedure exists, and by tests to count invocations). */
const setWithdrawalHook = (fn) => { hook = fn; };

module.exports = { onWithdrawn, setWithdrawalHook, defaultHook };
