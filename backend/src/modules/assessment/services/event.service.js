const prisma = require('../../../shared/prisma');

async function recordEvent(tx, { attemptId, itemId = null, eventType, sessionNumber, metadata = null }) {
  const client = tx || prisma;
  return client.responseEvent.create({
    data: { attemptId, itemId, eventType, sessionNumber, metadata },
  });
}

module.exports = { recordEvent };
