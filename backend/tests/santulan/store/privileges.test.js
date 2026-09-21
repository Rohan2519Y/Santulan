/* Runtime credential privileges (G-13, G-14, G-15; B08-006, B08-054/055, SEC-12). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');
const { COLLECTIONS_BY_TIER, collections, views } = require('../../../db/schema');

const fx = H.withFixtures('privileges');
afterAll(async () => { await fx.cleanup(); await H.closeAll(); });

const unauthorized = (p) => H.expectRefused(p, 13);

const sample = {
  audit_logs: () => F.audit(),
  score_results: () => F.score(F.hex('a').slice(0, 8) + '-0000-4000-8000-00000000000a', F.participant()._id, F.versionDoc()._id),
  response_events: () => F.responseEvent(F.attempt(F.participant()._id, F.versionDoc()._id)._id),
  items: () => F.item(F.versionDoc()._id),
  participant_cohort_history: () => F.cohortHistory(F.participant()._id, F.cohort(F.institution()._id)._id, F.institution()._id),
  growth_reviews: () => ({ _id: F.versionDoc()._id, goal_id: F.versionDoc()._id, review_date: '2026-01-01', what_happened: null, barrier: null, learning: null, adjustment: null, evidence_note: null, next_step: null, created_at: new Date() }),
  pathway_decisions: () => F.pathwayDecision(F.participant()._id, F.attempt(F.participant()._id, F.versionDoc()._id)._id),
  pathway_reviews: () => ({ _id: F.versionDoc()._id, pathway_decision_id: F.versionDoc()._id, outcome: 'CONFIRMED', evidence_note: null, support_change: null, next_step: null, reviewed_by: null, reviewed_at: new Date() }),
};

describe('G-13 Tier A collections are append-only for the runtime credential', () => {
  test('G-13 the eight Tier A collections are the ones the contract names', () => {
    expect([...COLLECTIONS_BY_TIER.A].sort()).toEqual(
      ['audit_logs', 'growth_reviews', 'items', 'participant_cohort_history', 'pathway_decisions', 'pathway_reviews', 'response_events', 'score_results'],
    );
  });

  test('B08-006 find and insert work; update and remove are Unauthorized', async () => {
    const db = await H.runtime();
    for (const name of COLLECTIONS_BY_TIER.A) {
      const doc = sample[name]();
      await fx.insertRuntime(name, doc);
      expect(await db.collection(name).findOne({ _id: doc._id })).toBeTruthy();
      await unauthorized(db.collection(name).updateOne({ _id: doc._id }, { $set: { touched: true } }));
      await unauthorized(db.collection(name).replaceOne({ _id: doc._id }, doc));
      await unauthorized(db.collection(name).deleteOne({ _id: doc._id }));
    }
  });

  test('B08-054 audit rows can be neither edited nor deleted', async () => {
    const db = await H.runtime();
    const a = await fx.insertRuntime('audit_logs', F.audit());
    await unauthorized(db.collection('audit_logs').updateOne({ _id: a._id }, { $set: { reason: 'edited' } }));
    await unauthorized(db.collection('audit_logs').deleteMany({}));
  });
});

describe('G-14 no remove anywhere', () => {
  test('G-14 deleteOne and deleteMany are Unauthorized on every collection', async () => {
    const db = await H.runtime();
    for (const c of collections) {
      await unauthorized(db.collection(c.name).deleteOne({ _id: 'none' }));
      await unauthorized(db.collection(c.name).deleteMany({ _id: 'none' }));
    }
  });

  test('B08-055 Tier B updates work only where the tier allows (responses.is_current)', async () => {
    const db = await H.runtime();
    const r = await fx.insertRuntime('responses', F.response(F.hex('x').slice(0, 8) + '-0000-4000-8000-00000000000b', F.hex('y').slice(0, 8) + '-0000-4000-8000-00000000000c'));
    const res = await db.collection('responses').updateOne({ _id: r._id }, { $set: { is_current: false } });
    expect(res.modifiedCount).toBe(1);
    await unauthorized(db.collection('responses').deleteOne({ _id: r._id }));
  });
});

describe('G-15 no structural rights', () => {
  test('SEC-12 the runtime credential cannot create or drop collections or indexes, change validators, or manage users', async () => {
    const db = await H.runtime();
    await unauthorized(db.createCollection('fx_rogue'));
    await unauthorized(db.collection('participants').createIndex({ rogue: 1 }, { name: 'rogue' }));
    await unauthorized(db.collection('participants').dropIndex('uq_participants_santulan_id'));
    await unauthorized(db.command({ collMod: 'participants', validator: {} }));
    await unauthorized(db.collection('institutions').drop());
    await unauthorized(db.collection('institutions').rename('institutions_x'));
    await unauthorized(db.command({ createUser: 'rogue', pwd: 'x', roles: [] }));
    await unauthorized(db.command({ createRole: 'rogue', privileges: [], roles: [] }));
    await unauthorized(db.command({ grantRolesToUser: 'santulan_runtime', roles: [{ role: 'dbOwner', db: db.databaseName }] }));
  });

  test('SEC-12 the runtime credential is not privileged: it cannot read foreign databases or system collections', async () => {
    const client = await H.rawRuntimeClient();
    await unauthorized(client.db('admin').collection('system.users').find({}).toArray());
    await unauthorized(client.db('local').collection('oplog.rs').findOne({}));
    await unauthorized(client.db('some_other_database').collection('anything').findOne({}));
    await unauthorized((await H.runtime()).collection('_data_migrations').insertOne({ _id: 'x' }));
    await unauthorized((await H.runtime()).collection('unknown_collection').insertOne({ a: 1 }));
  });

  test('G-15 the runtime credential has no rights on v_candidate_subdomain_scores', async () => {
    const db = await H.runtime();
    await unauthorized(db.collection('v_candidate_subdomain_scores').find({}).toArray());
    const research = views.filter((v) => !v.research_only).map((v) => v.name);
    for (const v of research) expect(await db.collection(v).find({}).limit(1).toArray()).toBeDefined();
  });
});
