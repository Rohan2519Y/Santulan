/* Ordered data-model definition (feature 006). Migrations import this; nothing else defines collections. */
const { collections, canonical, DEV_COLLECTIONS } = require('./collections');
const { indexes, devIndexes } = require('./indexes');
const { views } = require('./views');
const { ROLE_NAME, runtimePrivileges } = require('./roles');

// Bump when a new numbered data-model migration changes the shape; the API refuses to start on a mismatch (G-17).
const DATA_MODEL_VERSION = '006.1';

const COLLECTIONS_BY_TIER = {
  A: collections.filter((c) => c.tier === 'A').map((c) => c.name),
  B: collections.filter((c) => c.tier === 'B').map((c) => c.name),
};

module.exports = {
  DATA_MODEL_VERSION,
  collections,
  canonical,
  DEV_COLLECTIONS,
  indexes,
  devIndexes,
  views,
  ROLE_NAME,
  runtimePrivileges,
  COLLECTIONS_BY_TIER,
};
