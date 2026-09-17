const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');

/** FR-013: every control action is audit-logged with actor + timestamp + reason. */
async function recordControl(actorId, { action, reason }) {
  return prisma.participationControl.create({ data: { actorId, action, reason: reason || null } });
}

async function getCurrentControl() {
  return prisma.participationControl.findFirst({ orderBy: { createdAt: 'desc' } });
}

/** Attempt-creation enforces the current control (FR-013); default is OPEN. */
async function assertParticipationOpen() {
  const latest = await getCurrentControl();
  if (latest && (latest.action === 'PAUSE' || latest.action === 'STOP')) {
    throw new HttpError(409, 'ATTEMPT_UNAVAILABLE', `Participation is currently ${latest.action.toLowerCase()}d`);
  }
}

module.exports = { recordControl, getCurrentControl, assertParticipationOpen };
