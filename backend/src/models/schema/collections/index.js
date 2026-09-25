const identity = require('./identity');
const content = require('./content');
const delivery = require('./delivery');
const scoring = require('./scoring');
const reporting = require('./reporting');
const research = require('./research');

// Ordered: 27 canonical collections then the one non-canonical dev collection (last).
const all = [...identity, ...content, ...delivery, ...scoring, ...reporting, ...research];
const DEV_COLLECTIONS = ['dev_identity_credentials'];

module.exports = {
  collections: all,
  canonical: all.filter((c) => !DEV_COLLECTIONS.includes(c.name)),
  DEV_COLLECTIONS,
};
