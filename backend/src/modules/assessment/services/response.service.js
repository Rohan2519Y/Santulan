const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');
const { recordEvent } = require('./event.service');
const { setParticipantScope } = require('../../../shared/utils/rls');

const ANSWERABLE_STATES = ['IN_PROGRESS', 'PAUSED'];

/**
 * FR-004/BF-01: every edit writes a NEW response row (response_version + 1,
 * supersedes_response_id -> previous CURRENT, is_current=false on the prior
 * row); idempotency_key makes retries safe (research.md §4). T053: the whole
 * operation runs under the caller's RLS participant scope.
 */
async function saveResponse(attempt, participantProfileId, input) {
  if (!ANSWERABLE_STATES.includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', 'Attempt is not in an answerable state');
  }

  const item = await prisma.item.findUnique({ where: { id: input.itemId } });
  if (!item || item.assessmentVersionId !== attempt.assessmentVersionId) {
    throw new HttpError(422, 'ITEM_NOT_ELIGIBLE', "Item does not belong to the attempt's version");
  }

  return prisma.$transaction(async (tx) => {
    await setParticipantScope(tx, participantProfileId);

    const existingByKey = await tx.response.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingByKey) return existingByKey;

    const previousCurrent = await tx.response.findFirst({
      where: { attemptId: attempt.id, itemId: item.id, isCurrent: true },
    });

    if (previousCurrent) {
      await tx.response.update({ where: { id: previousCurrent.id }, data: { isCurrent: false } });
    }

    let created;
    try {
      created = await tx.response.create({
        data: {
          attemptId: attempt.id,
          itemId: item.id,
          participantProfileId,
          responseValue: input.value,
          responseVersion: previousCurrent ? previousCurrent.responseVersion + 1 : 1,
          isCurrent: true,
          supersedesResponseId: previousCurrent ? previousCurrent.id : null,
          answeredAt: new Date(),
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        // Concurrent retry raced us on idempotency_key; the other write won.
        const raced = await tx.response.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (raced) return raced;
      }
      throw err;
    }

    await recordEvent(tx, {
      attemptId: attempt.id,
      itemId: item.id,
      eventType: 'RESPONSE_SAVED',
      sessionNumber: attempt.sessionCount,
    });

    return created;
  });
}

module.exports = { saveResponse };
