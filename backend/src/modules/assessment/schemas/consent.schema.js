const { z } = require('zod');

const recordConsentSchema = z.object({
  consentType: z.enum(['ADULT_SELF_CONSENT', 'PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']),
  protocolVersion: z.string().min(1),
  verificationMethod: z.string().min(1).optional(),
});

module.exports = { recordConsentSchema };
