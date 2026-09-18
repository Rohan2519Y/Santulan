const { randomUUID } = require('crypto');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const { deriveAgeBand, deriveIsMinor, deriveToolBand } = require('../constants');

function deriveContext(participationRoute, toolBand) {
  if (participationRoute === 'OPEN') return 'GENERAL';
  return toolBand === 'ADOLESCENT' ? 'SCHOOL' : 'COLLEGE_WORK';
}

async function findProfileByUserId(userId) {
  const { rows } = await db.query('SELECT * FROM participant_profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function getProfile(userId) {
  const profile = await findProfileByUserId(userId);
  if (!profile) {
    throw new HttpError(404, 'PROFILE_NOT_DECLARED', 'Participant profile not yet declared');
  }
  return profile;
}

async function declareProfile(userId, input) {
  const { age, participationRoute, institutionId } = input; // institutionId: accepted for contract parity; institution hierarchy is out of scope for this feature (plan.md)
  void institutionId;

  const ageBand = deriveAgeBand(age);
  if (!ageBand) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Age is outside the supported 13-25 range');
  }
  const toolBand = deriveToolBand(age);
  const isMinor = deriveIsMinor(age);
  const context = deriveContext(participationRoute, toolBand);

  const existing = await findProfileByUserId(userId);
  if (existing) {
    const { rows } = await db.query(
      `UPDATE participant_profiles
       SET age_band = $1, is_minor = $2, context = $3, participation_route = $4
       WHERE user_id = $5
       RETURNING *`,
      [ageBand, isMinor, context, participationRoute, userId]
    );
    return rows[0];
  }

  const santulanId = `STLN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { rows } = await db.query(
    `INSERT INTO participant_profiles (id, user_id, santulan_id, age_band, is_minor, context, participation_route)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [randomUUID(), userId, santulanId, ageBand, isMinor, context, participationRoute]
  );
  return rows[0];
}

module.exports = { getProfile, declareProfile };
