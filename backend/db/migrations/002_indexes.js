/* 002 - the 50 named canonical indexes (+ the dev-only one), data-model section 5. Idempotent by name; a same-name index with a different definition fails. */
const { indexes, devIndexes } = require('../../src/models/schema');

module.exports = {
  name: '002_indexes',
  async up(db) {
    for (const i of [...indexes, ...devIndexes]) {
      const opts = { name: i.name };
      if (i.unique) opts.unique = true;
      if (i.partial) opts.partialFilterExpression = i.partial;
      await db.collection(i.collection).createIndex(i.keys, opts);
    }
  },
};
