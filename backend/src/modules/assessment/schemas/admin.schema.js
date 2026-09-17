const { z } = require('zod');

const controlSchema = z.object({
  action: z.enum(['PAUSE', 'STOP', 'REOPEN']),
  reason: z.string().min(1).optional(),
});

const qualityFlagReviewSchema = z.object({
  disposition: z.string().min(1),
});

module.exports = { controlSchema, qualityFlagReviewSchema };
