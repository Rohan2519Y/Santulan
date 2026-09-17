const { z } = require('zod');

const declareProfileSchema = z.object({
  age: z.number().int().min(13).max(25),
  participationRoute: z.enum(['OPEN', 'INSTITUTIONAL']),
  institutionId: z.string().nullable().optional(),
});

module.exports = { declareProfileSchema };
