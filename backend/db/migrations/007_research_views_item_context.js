/*
 * 007 - `v_research_item_responses` gains `assessment_version_id`, `domain_code`, `subdomain_code` (the rebuilt research
 * export's ITEM_RESPONSES_LONG sheet needs them to group by domain/subdomain and to know which item catalog to diff
 * against for missing-item detection). Same re-apply-every-view approach as 003 (collMod is idempotent - a view whose
 * pipeline is unchanged is simply rewritten to the same definition). Records the bumped data-model version.
 */
const { views, DATA_MODEL_VERSION } = require('../../src/models/schema');

module.exports = {
  name: '007_research_views_item_context',
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const v of views) {
      if (existing.has(v.name)) await db.command({ collMod: v.name, viewOn: v.source, pipeline: v.pipeline });
      else await db.createCollection(v.name, { viewOn: v.source, pipeline: v.pipeline });
    }
    await db.collection('_data_migrations').updateOne(
      { _id: 'dataModelVersion' },
      { $set: { value: DATA_MODEL_VERSION, updatedAt: new Date() } },
      { upsert: true },
    );
  },
};
