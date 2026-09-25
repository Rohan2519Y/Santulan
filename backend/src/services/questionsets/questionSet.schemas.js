/* Request schemas for the question-set endpoints (strict: unknown keys are a VALIDATION_ERROR). */
const { z } = require('zod');
const { strictObject } = require('../../middleware/http');

const listQuery = z.object({
  ageGroup: z.enum(['ADOLESCENT', 'EMERGING_ADULT']).optional(),
  status: z.enum(['DRAFT', 'FROZEN', 'RETIRED']).optional(),
}).strict();

const freezeSchema = strictObject({});
const reasonSchema = strictObject({ reason: z.string().trim().min(3).max(300) });
const idParam = z.string().uuid();

module.exports = { listQuery, freezeSchema, reasonSchema, idParam };
