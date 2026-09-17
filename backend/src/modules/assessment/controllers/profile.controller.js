const profileService = require('../services/profile.service');

function serialize(profile) {
  return {
    id: profile.id,
    ageBand: profile.ageBand,
    isMinor: profile.isMinor,
    context: profile.context,
    route: profile.participationRoute,
  };
}

async function getProfile(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    res.json({ profile: serialize(profile) });
  } catch (err) {
    next(err);
  }
}

async function declareProfile(req, res, next) {
  try {
    const profile = await profileService.declareProfile(req.user.id, req.body);
    res.status(201).json({ profile: serialize(profile) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, declareProfile };
