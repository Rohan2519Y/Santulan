/*
 * Role `santulan_runtime` (database-contract section 2.1). Tier A: find+insert. Tier B and the dev credential collection:
 * find+insert+update. Research views: find. NOTHING else: no remove, createIndex, dropIndex, collMod, createCollection,
 * dropCollection, renameCollection, and no user/role actions. `v_candidate_subdomain_scores` is not granted.
 */
const { collections } = require('./collections');
const { views } = require('./views');

const ROLE_NAME = 'santulan_runtime';

function runtimePrivileges(db) {
  const priv = [];
  for (const c of collections) {
    const actions = c.tier === 'A' ? ['find', 'insert'] : ['find', 'insert', 'update'];
    priv.push({ resource: { db, collection: c.name }, actions });
  }
  for (const v of views) {
    if (v.research_only) continue;
    priv.push({ resource: { db, collection: v.name }, actions: ['find'] });
  }
  // Bootstrapping metadata: the start-up check reads the data-model version marker; only the migrator writes it.
  priv.push({ resource: { db, collection: '_data_migrations' }, actions: ['find'] });
  return priv;
}

module.exports = { ROLE_NAME, runtimePrivileges };
