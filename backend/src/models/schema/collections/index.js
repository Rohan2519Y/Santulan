const identity = require('./identity');
const content = require('./content');
const delivery = require('./delivery');
const scoring = require('./scoring');
const reporting = require('./reporting');
const research = require('./research');

// Ordered: the 27 BUILD 01/CR-006 canonical collections, participant_profiles (added per the Student Demographic &
// Research Profile Capture Form v1.0), participant_pilot_details (an explicit override of that same form's own
// exclusion list - see identity.js), then the one non-canonical dev collection (last).
const all = [...identity, ...content, ...delivery, ...scoring, ...reporting, ...research];
const DEV_COLLECTIONS = ['dev_identity_credentials'];

module.exports = {
  collections: all,
  canonical: all.filter((c) => !DEV_COLLECTIONS.includes(c.name)),
  DEV_COLLECTIONS,
};
