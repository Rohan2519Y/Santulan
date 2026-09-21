/* 003 - the eight v_research_* views and the research-only v_candidate_subdomain_scores (data-model section 8). Idempotent. */
const { views } = require('../schema');

module.exports = {
  name: '003_research_views',
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const v of views) {
      if (existing.has(v.name)) await db.command({ collMod: v.name, viewOn: v.source, pipeline: v.pipeline });
      else await db.createCollection(v.name, { viewOn: v.source, pipeline: v.pipeline });
    }
  },
};
