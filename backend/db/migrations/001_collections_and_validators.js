/* 001 - the 27 canonical collections + the dev credential collection, each with its $jsonSchema/$expr validator (data-model section 4). Idempotent. */
const { collections } = require('../schema');

module.exports = {
  name: '001_collections_and_validators',
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const c of collections) {
      const opts = { validator: c.validator, validationLevel: 'strict', validationAction: 'error' };
      if (existing.has(c.name)) await db.command({ collMod: c.name, ...opts });
      else await db.createCollection(c.name, opts);
    }
  },
};
