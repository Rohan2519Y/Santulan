/*
 * Role `santulan_runtime` (database-contract section 2.1). Tier A: find+insert. Tier B and the dev credential collection:
 * find+insert+update. Research views: find. NOTHING else: no remove, createIndex, dropIndex, collMod, createCollection,
 * dropCollection, renameCollection, and no user/role actions. `v_candidate_subdomain_scores` is not granted.
 *
 * One Tier A exception (migration 005): `items` also gets `update`, so a Super Admin can show/hide a question from
 * participants (items.status). This grants the ACTION at the database role; access.js narrows it to the single
 * `status` field at the application layer (dal.js refuses any other field even though the role would permit the verb) -
 * the question's text and options still have no way to ever change.
 */
const { collections } = require('./collections');
const { views } = require('./views');

const ROLE_NAME = 'santulan_runtime';
const TIER_A_UPDATE_EXCEPTIONS = new Set(['items']);

function runtimePrivileges(db) {
  const priv = [];
  for (const c of collections) {
    const actions = (c.tier === 'A' && !TIER_A_UPDATE_EXCEPTIONS.has(c.name)) ? ['find', 'insert'] : ['find', 'insert', 'update'];
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
