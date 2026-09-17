const consentService = require('../services/consent.service');
const profileService = require('../services/profile.service');

async function recordConsent(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const consent = await consentService.recordConsent(profile.id, req.body);
    res.status(201).json({
      consent: {
        id: consent.id,
        consentType: consent.consentType,
        status: consent.status,
        verifiedAt: consent.verifiedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { recordConsent };
