const profileService = require('../services/profile.service');
const attemptService = require('../services/attempt.service');
const responseService = require('../services/response.service');

async function saveResponse(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.findOwnedAttempt(req.params.attemptId, profile.id);
    const response = await responseService.saveResponse(attempt, profile.id, req.body);
    res.status(201).json({
      response: {
        itemId: response.itemId,
        value: response.responseValue,
        responseVersion: response.responseVersion,
        isCurrent: response.isCurrent,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { saveResponse };
