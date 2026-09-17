const { Router } = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../../shared/middleware/auth');
const { validate } = require('../../shared/utils/validate');

const profileController = require('../../modules/assessment/controllers/profile.controller');
const consentController = require('../../modules/assessment/controllers/consent.controller');
const attemptController = require('../../modules/assessment/controllers/attempt.controller');
const responseController = require('../../modules/assessment/controllers/response.controller');
const adminController = require('../../modules/assessment/controllers/admin.controller');
const reportController = require('../../modules/assessment/controllers/report.controller');

const { declareProfileSchema } = require('../../modules/assessment/schemas/profile.schema');
const { recordConsentSchema } = require('../../modules/assessment/schemas/consent.schema');
const { saveResponseSchema } = require('../../modules/assessment/schemas/response.schema');
const { controlSchema, qualityFlagReviewSchema } = require('../../modules/assessment/schemas/admin.schema');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);

// Participant (role: participant), mounted under /assessments so requireRole
// only ever runs for participant-shaped paths (a shared prefix with admin.use
// would otherwise short-circuit BEFORE Express tries the admin router).
const participant = Router();
participant.use(requireRole('participant'));

participant.get('/profile', profileController.getProfile);
participant.post('/profile', validate(declareProfileSchema), profileController.declareProfile);

participant.post('/consents', validate(recordConsentSchema), consentController.recordConsent);

participant.post('/attempts', attemptController.startOrResume);
participant.post('/attempts/:attemptId/responses', validate(saveResponseSchema), responseController.saveResponse);
participant.post('/attempts/:attemptId/pause', attemptController.pause);
participant.post('/attempts/:attemptId/resume', attemptController.resume);
participant.post('/attempts/:attemptId/submit', attemptController.submit);
participant.get('/attempts/:attemptId/scores', attemptController.getScores);
participant.get('/reports/:reportId', reportController.getReport);
participant.post('/reports/:reportId/retry', reportController.retryReport);

router.use('/assessments', participant);

// Admin (role: admin), mounted under /admin/assessments.
const admin = Router();
admin.use(requireRole('admin'));

admin.post('/import', upload.single('file'), adminController.importItemPool);
admin.post('/control', validate(controlSchema), adminController.control);
admin.get('/submissions', adminController.listSubmissions);
admin.get('/submissions/:attemptId', adminController.getSubmissionDetail);
admin.patch('/quality-flags/:flagId', validate(qualityFlagReviewSchema), adminController.reviewQualityFlag);

router.use('/admin/assessments', admin);

module.exports = router;
