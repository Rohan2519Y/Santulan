const { randomUUID } = require('crypto');
const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');
const { deriveAgeBand, deriveIsMinor, deriveToolBand } = require('../constants');

function deriveContext(participationRoute, toolBand) {
  if (participationRoute === 'OPEN') return 'GENERAL';
  return toolBand === 'ADOLESCENT' ? 'SCHOOL' : 'COLLEGE_WORK';
}

async function getProfile(userId) {
  const profile = await prisma.participantProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new HttpError(404, 'PROFILE_NOT_DECLARED', 'Participant profile not yet declared');
  }
  return profile;
}

async function declareProfile(userId, input) {
  const { age, participationRoute, institutionId } = input; // institutionId: accepted for contract parity; institution hierarchy is out of scope for this feature (plan.md)
  void institutionId;

  const ageBand = deriveAgeBand(age);
  if (!ageBand) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Age is outside the supported 13-25 range');
  }
  const toolBand = deriveToolBand(age);
  const isMinor = deriveIsMinor(age);
  const context = deriveContext(participationRoute, toolBand);

  const existing = await prisma.participantProfile.findUnique({ where: { userId } });
  if (existing) {
    return prisma.participantProfile.update({
      where: { userId },
      data: { ageBand, isMinor, context, participationRoute },
    });
  }

  const santulanId = `STLN-${randomUUID().slice(0, 8).toUpperCase()}`;
  return prisma.participantProfile.create({
    data: { userId, santulanId, ageBand, isMinor, context, participationRoute },
  });
}

module.exports = { getProfile, declareProfile };
