/*
 * 008 - lets a participant edit their validation profile (Student Demographic & Research Profile Capture Form v1.0):
 * an edit is a new row (Tier A stays insert-only), the latest by created_at is the current answer. Drops the old
 * `uq_participant_profiles_participant` unique index (it forbade a second row per participant) and creates the
 * replacement `idx_participant_profiles_participant_latest` (participant_id + created_at desc, not unique) that
 * `identity.findProfile`'s sorted lookup now relies on. Same collection, same validator - no collMod needed.
 */
const { indexes, DATA_MODEL_VERSION } = require('../../src/models/schema');

const OLD_INDEX = 'uq_participant_profiles_participant';
const COLLECTION_NAME = 'participant_profiles';

module.exports = {
  name: '008_participant_profiles_editable',
  async up(db) {
    const existing = new Set((await db.collection(COLLECTION_NAME).listIndexes().toArray()).map((i) => i.name));
    if (existing.has(OLD_INDEX)) await db.collection(COLLECTION_NAME).dropIndex(OLD_INDEX);

    for (const i of indexes.filter((x) => x.collection === COLLECTION_NAME)) {
      const opts = { name: i.name };
      if (i.unique) opts.unique = true;
      if (i.partial) opts.partialFilterExpression = i.partial;
      await db.collection(i.collection).createIndex(i.keys, opts);
    }

    await db.collection('_data_migrations').updateOne(
      { _id: 'dataModelVersion' },
      { $set: { value: DATA_MODEL_VERSION, updatedAt: new Date() } },
      { upsert: true },
    );
  },
};
