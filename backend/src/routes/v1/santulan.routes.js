/*
 * Canonical API router (specs/005-v3-1-canonical-alignment/contracts/api.md). Mounted at /api/v1.
 * Every route is added here as its story is built; nothing here accepts scores, versions, Santulan IDs, participant ids
 * or database context from the client.
 */
const { Router } = require('express');
const multer = require('multer');
const config = require('../../config');
const { validate } = require('../../utils/validate');
const { requireParticipantToken, requireActiveSuperAdmin, requireInternalOrSuperAdmin, requireParticipantOrPrivileged, requireInternal } = require('../../middleware/auth');
const { correlation } = require('../../middleware/http');
const { createRegistrationThrottle } = require('../../middleware/throttle');
const auth = require('../../controllers/auth.controller');
const consent = require('../../controllers/consent.controller');
const delivery = require('../../controllers/delivery.controller');
const scoring = require('../../controllers/scoring.controller');
const registration = require('../../controllers/registration.controller');
const roster = require('../../controllers/roster.controller');
const questionSets = require('../../controllers/questionSet.controller');
const releaseFlags = require('../../controllers/releaseFlags.controller');
const wording = require('../../controllers/wording.controller');
const admin = require('../../controllers/admin.controller');
const researchExports = require('../../controllers/export.controller');
const reports = require('../../controllers/reporting.controller');
const growth = require('../../controllers/growth.controller');
const pathways = require('../../controllers/pathway.controller');
const { registerP5Hook } = require('../../services/pathways/p5Hook');

// Q09 -> P5 wiring (BUILD 07 §15): the hook is unconditional and never gated by a release flag.
registerP5Hook();

const router = Router();
router.use(correlation);

const registrationThrottle = createRegistrationThrottle(config.registrationThrottle);
const rosterUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('roster');

// --- Authentication (dev identity adapter, D-17)
// The OPEN-registration throttle protects the OTP flow only (throttle.js §7); institutional/participant login uses a
// password + bcrypt (per-identity limits), never this middleware (SEC-17).
const authThrottle = createRegistrationThrottle(config.registrationThrottle);
// OTP login/registration is commented out, not removed: OPEN participants now use Santulan ID + password like
// institutional participants (registerOpen in registration.controller.js), since no real OTP/SMS provider exists to
// integrate with yet. Re-enable these two lines (and /participants/age-declaration below) once one is.
// router.post('/auth/request-otp', authThrottle, validate(auth.requestOtpSchema), auth.requestOtp);
// router.post('/auth/verify-otp', authThrottle, validate(auth.verifyOtpSchema), auth.verifyOtp);
router.post('/auth/login', validate(auth.loginSchema), auth.login);
router.post('/auth/set-password', validate(auth.setPasswordSchema), auth.setPassword);
router.post('/auth/forgot-password', authThrottle, validate(auth.forgotPasswordSchema), auth.forgotPassword);
router.post('/admin/participants/:id/credential-reset', requireActiveSuperAdmin, auth.credentialReset);

// --- Identity, registration and age routing (BUILD 03)
router.post('/registration/route', validate(registration.routeSchema), registration.resolveRoute);
router.post('/registrations/open', registrationThrottle, validate(registration.openSchema), registration.registerOpen);
router.post('/registrations/institutional', requireActiveSuperAdmin, validate(registration.institutionalSchema), registration.registerInstitutional);
// router.post('/participants/age-declaration', registrationThrottle, validate(registration.ageDeclarationSchema), registration.ageDeclaration); // OTP-only completion step; see note above
router.get('/registration/state', requireParticipantToken, registration.state);
// ASSUMED addition (Student Demographic & Research Profile Capture Form v1.0): the recommended validation-profile
// extension, first captured at registration and editable afterwards (Tier A: an edit is a new row, latest wins).
router.post('/participants/profile', requireParticipantToken, validate(registration.profileSchema), registration.submitProfile);
router.get('/participants/profile', requireParticipantToken, registration.profile);
// ASSUMED addition, explicit override of that same form's own "exclude full name/DOB/religion" list - see
// participantPilotDetailsRules.js. Same editable, Tier A pattern as the profile above.
router.post('/participants/pilot-details', requireParticipantToken, validate(registration.pilotDetailsSchema), registration.submitPilotDetails);
router.get('/participants/pilot-details', requireParticipantToken, registration.pilotDetails);

// --- Roster import + one-time credential export (BUILD 03 §9 / US4). Super admin; validates before it ever writes.
router.post('/cohorts/import', requireActiveSuperAdmin, rosterUpload, roster.importRoster);
router.get('/admin/credentials/export/:importId', requireActiveSuperAdmin, roster.exportCredentials);

// --- Question sets (feature 006): spreadsheet upload into draft sets. Active SUPER_ADMIN only.
router.get('/admin/question-sets/template', requireActiveSuperAdmin, questionSets.template);
// ASSUMED addition: preview validates a workbook without saving it, so the admin can review and confirm before the
// real upload below actually commits it.
router.post('/admin/question-sets/preview', requireActiveSuperAdmin, questionSets.receiveUpload, questionSets.previewUpload);
router.post('/admin/question-sets', requireActiveSuperAdmin, questionSets.receiveUpload, questionSets.upload);
router.get('/admin/question-sets', requireActiveSuperAdmin, questionSets.list);
router.get('/admin/question-sets/:id', requireActiveSuperAdmin, questionSets.get);
router.post('/admin/question-sets/:id/freeze', requireActiveSuperAdmin, validate(questionSets.schemas.freezeSchema), questionSets.freeze);
router.post('/admin/question-sets/:id/open', requireActiveSuperAdmin, validate(questionSets.schemas.reasonSchema), questionSets.open);
router.post('/admin/question-sets/:id/close', requireActiveSuperAdmin, validate(questionSets.schemas.reasonSchema), questionSets.close);
router.post('/admin/question-sets/:id/delete', requireActiveSuperAdmin, validate(questionSets.schemas.freezeSchema), questionSets.delete);
router.post('/admin/question-sets/:id/items/:itemId/status', requireActiveSuperAdmin, validate(questionSets.schemas.itemStatusSchema), questionSets.setItemStatus);
router.get('/admin/question-sets/:id/response-distribution', requireActiveSuperAdmin, questionSets.responseDistribution);
router.get('/admin/question-sets/:id/response-distribution/export', requireActiveSuperAdmin, questionSets.exportResponseDistribution);
router.get('/admin/question-sets/:id/unified-export', requireActiveSuperAdmin, questionSets.exportUnified);

// --- Release switches (scoring master section 15): four audited switches, all OFF by default. Active SUPER_ADMIN only.
router.get('/admin/release-flags', requireActiveSuperAdmin, releaseFlags.list);
router.post('/admin/release-flags/:flag', requireActiveSuperAdmin, validate(releaseFlags.setSchema), releaseFlags.set);

// --- Report wording (interpretation_rules): the admin UI path alongside scripts/wording-load.js. Active SUPER_ADMIN only.
router.get('/admin/wording', requireActiveSuperAdmin, wording.list);
router.post('/admin/wording', requireActiveSuperAdmin, validate(wording.addSchema), wording.add);
router.post('/admin/wording/:id/approve', requireActiveSuperAdmin, validate(wording.approveSchema), wording.approve);

// --- Consent, assent and the verification gate (BUILD 04). Consent never creates an attempt.
router.get('/consents/requirements', requireParticipantToken, consent.requirements);
router.get('/consents/gate', requireParticipantToken, consent.gate);
router.post('/consents', requireInternalOrSuperAdmin, validate(consent.createSchema), consent.create);
// CR-006-13: an adult participant's own one-checkbox self-consent (create+grant+verify in one call). A minor is refused by
// the service; the parent/guardian + assent flow below is unchanged for them.
router.post('/consents/self-consent', requireParticipantToken, validate(consent.emptySchema), consent.selfConsent);
// CR-006-14: a minor participant confirms both required consents themselves in one call - their own STUDENT_ASSENT, and
// PARENT_GUARDIAN_CONSENT attested on the parent/guardian's behalf (verification_method STUDENT_ATTESTED_FOR_PARENT), a
// temporary stand-in until a real parent/guardian portal exists. An adult is refused by the service.
router.post('/consents/minor-self-service', requireParticipantToken, validate(consent.emptySchema), consent.minorSelfService);
router.post('/consents/:id/grant', requireParticipantOrPrivileged, validate(consent.emptySchema), consent.grant);
router.post('/consents/:id/verify', requireInternalOrSuperAdmin, validate(consent.verifySchema), consent.verify);
router.post('/consents/:id/withdraw', requireParticipantOrPrivileged, validate(consent.emptySchema), consent.withdraw);

// --- Assessment delivery (BUILD 05). Participant token only; delivery stops at SUBMITTED.
router.post('/attempts', requireParticipantToken, validate(delivery.createSchema), delivery.create);
router.get('/attempts/:id', requireParticipantToken, delivery.get);
router.post('/attempts/:id/sessions/resume', requireParticipantToken, validate(delivery.emptySchema), delivery.resume);
router.post('/attempts/:id/responses', requireParticipantToken, validate(delivery.saveResponseSchema), delivery.saveResponse);
router.get('/attempts/:id/items', requireParticipantToken, delivery.items);
router.get('/attempts/:id/responses', requireParticipantToken, delivery.currentResponses);
router.post('/attempts/:id/pause', requireParticipantToken, validate(delivery.pauseSchema), delivery.pause);
router.post('/attempts/:id/submit', requireParticipantToken, validate(delivery.submitSchema), delivery.submit);

// --- Quality and scoring (BUILD 06). Internal key only for the engines; the participant reads only what RLS allows.
router.post('/internal/attempts/:id/quality', requireInternal, validate(scoring.emptySchema), scoring.quality);
router.post('/internal/attempts/:id/score', requireInternal, validate(scoring.scoreSchema), scoring.score);
router.get('/internal/attempts/:id/quality-flags', requireInternal, scoring.qualityFlags);
router.post('/internal/attempts/:id/safeguarding', requireInternal, validate(scoring.safeguardingSchema), scoring.safeguarding);
// GET /attempts/:id/scores is withdrawn (feature 006): the chart is read from the PROFILE section of the released report.

// --- Admin operations (BUILD 08): control plane, institutions, cohorts, participants, monitoring, quality review, audit log
router.get('/admin/assessment-control', requireActiveSuperAdmin, admin.getControl);
router.post('/admin/assessment-control', requireActiveSuperAdmin, validate(admin.controlSchema), admin.setControl);
router.get('/admin/institutions', requireActiveSuperAdmin, admin.listInstitutions);
router.post('/admin/institutions', requireActiveSuperAdmin, validate(admin.institutionCreateSchema), admin.createInstitution);
router.patch('/admin/institutions/:id', requireActiveSuperAdmin, validate(admin.institutionUpdateSchema), admin.updateInstitution);
router.get('/admin/cohorts', requireActiveSuperAdmin, admin.listCohorts);
router.post('/admin/cohorts', requireActiveSuperAdmin, validate(admin.cohortCreateSchema), admin.createCohort);
router.patch('/admin/cohorts/:id', requireActiveSuperAdmin, validate(admin.cohortUpdateSchema), admin.updateCohort);
router.get('/admin/participants', requireActiveSuperAdmin, admin.listParticipants);
router.post('/admin/participants/:id/status', requireActiveSuperAdmin, validate(admin.participantStatusSchema), admin.setParticipantStatus);
router.get('/admin/monitoring/summary', requireActiveSuperAdmin, admin.monitoringSummary);
// ASSUMED addition (docs/Santulan 2.0/Dashboard.jpeg): the dashboard page's one consolidated read.
router.get('/admin/dashboard', requireActiveSuperAdmin, admin.dashboardSummary);
router.get('/admin/quality-flags', requireActiveSuperAdmin, admin.listQualityFlags);
router.patch('/admin/quality-flags/:id', requireActiveSuperAdmin, validate(admin.flagReviewSchema), admin.reviewQualityFlag);
router.get('/admin/audit-logs', requireActiveSuperAdmin, admin.listAuditLogs);
router.get('/admin/submissions', requireActiveSuperAdmin, admin.listSubmissions);
router.get('/admin/submissions/:id', requireActiveSuperAdmin, admin.submissionDetail);
router.get('/admin/submissions/:id/responses', requireActiveSuperAdmin, admin.submissionResponses);
router.get('/admin/submissions/:id/responses/export', requireActiveSuperAdmin, admin.exportSubmissionResponses);
router.get('/admin/attempts/:id/pilot-report', requireActiveSuperAdmin, admin.pilotReportPdf);

// --- Research export (BUILD 08 section 10)
router.post('/research-exports', requireActiveSuperAdmin, validate(researchExports.requestSchema), researchExports.request);
router.get('/research-exports', requireActiveSuperAdmin, researchExports.list);
router.get('/research-exports/:id', requireActiveSuperAdmin, researchExports.status);
router.get('/research-exports/:id/download', requireActiveSuperAdmin, researchExports.download);

// --- Reports, growth plans and pathways (BUILD 07). The engines are internal; the participant reads only released snapshots.
router.post('/internal/attempts/:id/report', requireInternal, validate(reports.emptySchema), reports.generate);
router.post('/internal/reports/:id/retry', requireInternalOrSuperAdmin, validate(reports.emptySchema), reports.retry);
router.get('/reports/:id', requireParticipantToken, reports.get);
router.post('/internal/attempts/:id/pathways', requireInternalOrSuperAdmin, validate(pathways.decisionSchema), pathways.decide);
router.get('/growth-plans/:id', requireParticipantToken, growth.get);
router.post('/growth-plans/:id/priorities', requireParticipantToken, validate(growth.priorityUpdateSchema), growth.priorities);
router.post('/growth-plans/:id/goals', requireParticipantToken, validate(growth.goalSchema), growth.goals);
router.post('/growth-plans/:id/reviews', requireParticipantToken, validate(growth.reviewSchema), growth.reviews);

module.exports = router;
