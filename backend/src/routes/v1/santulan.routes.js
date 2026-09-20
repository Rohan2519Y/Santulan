/*
 * Canonical API router (specs/005-v3-1-canonical-alignment/contracts/api.md). Mounted at /api/v1.
 * Every route is added here as its story is built; nothing here accepts scores, versions, Santulan IDs, participant ids
 * or database context from the client.
 */
const { Router } = require('express');
const config = require('../../config');
const { validate } = require('../../shared/utils/validate');
const { requireParticipantToken, requireActiveSuperAdmin, requireInternalOrSuperAdmin, requireParticipantOrPrivileged, requireInternal } = require('../../shared/middleware/auth');
const { correlation } = require('../../modules/santulan/shared/http');
const { createRegistrationThrottle } = require('../../modules/santulan/security/throttle');
const auth = require('../../modules/santulan/identity/auth.controller');
const consent = require('../../modules/santulan/consent/consent.controller');
const delivery = require('../../modules/santulan/delivery/delivery.controller');
const scoring = require('../../modules/santulan/scoring/scoring.controller');
const registration = require('../../modules/santulan/registration/registration.controller');

const router = Router();
router.use(correlation);

const registrationThrottle = createRegistrationThrottle(config.registrationThrottle);

// --- Authentication (dev identity adapter, D-17)
const authThrottle = createRegistrationThrottle(config.registrationThrottle);
router.post('/auth/request-otp', authThrottle, validate(auth.requestOtpSchema), auth.requestOtp);
router.post('/auth/verify-otp', authThrottle, validate(auth.verifyOtpSchema), auth.verifyOtp);
router.post('/auth/login', authThrottle, validate(auth.loginSchema), auth.login);
router.post('/auth/set-password', authThrottle, validate(auth.setPasswordSchema), auth.setPassword);
router.post('/admin/participants/:id/credential-reset', requireActiveSuperAdmin, auth.credentialReset);

// --- Identity, registration and age routing (BUILD 03)
router.post('/registration/route', validate(registration.routeSchema), registration.resolveRoute);
router.post('/registrations/open', registrationThrottle, validate(registration.openSchema), registration.registerOpen);
router.post('/registrations/institutional', requireActiveSuperAdmin, validate(registration.institutionalSchema), registration.registerInstitutional);
router.post('/participants/age-declaration', registrationThrottle, validate(registration.ageDeclarationSchema), registration.ageDeclaration);
router.get('/registration/state', requireParticipantToken, registration.state);

// --- Consent, assent and the verification gate (BUILD 04). Consent never creates an attempt.
router.get('/consents/requirements', requireParticipantToken, consent.requirements);
router.get('/consents/gate', requireParticipantToken, consent.gate);
router.post('/consents', requireInternalOrSuperAdmin, validate(consent.createSchema), consent.create);
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
router.get('/attempts/:id/scores', requireParticipantToken, scoring.myScores);

module.exports = router;
