const { z } = require('zod');

const saveResponseSchema = z.object({
  itemId: z.string().min(1),
  value: z.number().int().min(1).max(5),
  idempotencyKey: z.string().min(1),
});

module.exports = { saveResponseSchema };
