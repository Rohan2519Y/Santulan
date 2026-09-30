/*
 * 009 - adds `participant_pilot_details` ("Santulan Pilot Study Details" PART A: full_name, date_of_birth, class,
 * gender, birth_order, sibling_count, religion, family_type, residence_type, state, school_type, study_medium,
 * board, academic_stream). This is an explicit override of the approved v1.0 profile form's own "Fields to EXCLUDE"
 * list (full_name/date_of_birth/religion are all named there) - see identity.js's collection comment. Same three
 * steps as 006 (participant_profiles) for this one new collection: create it with its validator, create its one
 * named index, then re-grant the runtime role and record the bumped data-model version.
 */
const { collections, indexes, ROLE_NAME, runtimePrivileges, DATA_MODEL_VERSION } = require('../../src/models/schema');

const USER_HOME_DB = 'santulan';
const COLLECTION_NAME = 'participant_pilot_details';

module.exports = {
  name: '009_participant_pilot_details',
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
