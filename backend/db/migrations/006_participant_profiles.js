/*
 * 006 - adds `participant_profiles` (Student Demographic & Research Profile Capture Form v1.0, "full recommended set" -
 * education, language, gender, region and accessibility context for sampling/fairness/DIF research only, never scoring).
 * Same three steps as 001+002+005 combined for this one new collection: create it with its validator, create its one
 * named index, then re-grant the runtime role (roles.js derives find+insert for it automatically - it's Tier A with no
 * update exception) and record the bumped data-model version. Idempotent throughout, same as those three.
 */
const { collections, indexes, ROLE_NAME, runtimePrivileges, DATA_MODEL_VERSION } = require('../../src/models/schema');

const USER_HOME_DB = 'santulan';
const COLLECTION_NAME = 'participant_profiles';

module.exports = {
  name: '006_participant_profiles',
  async up(db, { client }) {
    const c = collections.find((x) => x.name === COLLECTION_NAME);
    const opts = { validator: c.validator, validationLevel: 'strict', validationAction: 'error' };
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name));
    if (existing.has(COLLECTION_NAME)) await db.command({ collMod: COLLECTION_NAME, ...opts });
    else await db.createCollection(COLLECTION_NAME, opts);

    for (const i of indexes.filter((x) => x.collection === COLLECTION_NAME)) {
      const ixOpts = { name: i.name };
      if (i.unique) ixOpts.unique = true;
      if (i.partial) ixOpts.partialFilterExpression = i.partial;
      await db.collection(i.collection).createIndex(i.keys, ixOpts);
    }

    const privileges = runtimePrivileges(db.databaseName);
    const info = await db.command({ rolesInfo: ROLE_NAME });
    if (info.roles.length) await db.command({ dropRole: ROLE_NAME });
    await db.command({ createRole: ROLE_NAME, privileges, roles: [] });
    await client.db(USER_HOME_DB).command({
      grantRolesToUser: ROLE_NAME,
      roles: [{ role: ROLE_NAME, db: db.databaseName }],
    });

    await db.collection('_data_migrations').updateOne(
      { _id: 'dataModelVersion' },
      { $set: { value: DATA_MODEL_VERSION, updatedAt: new Date() } },
      { upsert: true },
    );
  },
};
