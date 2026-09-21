/* Reference content loader (T040; BUILD 01 section 10): 216 inactive actions, 72 draft prompts, nothing else. */
const H = require('../helpers/mongoHarness');
const { seedReference, buildReference } = require('../../../scripts/seed-reference');

afterAll(async () => { await H.closeAll(); });

describe('reference content', () => {
  test('T-B02-030 the workbook yields exactly 216 actions and 72 prompts, inactive and draft', () => {
    const { actions, prompts } = buildReference();
    expect(actions).toHaveLength(216);
    expect(prompts).toHaveLength(72);
    expect(actions.every((a) => a.active === false)).toBe(true);
    expect(prompts.every((p) => p.status === 'DRAFT')).toBe(true);
    const pairs = new Set(actions.map((a) => `${a.subdomain_code}|${a.progression_level}`));
    expect(pairs.size).toBe(216);
    expect(new Set(actions.map((a) => a.action_code)).size).toBe(216);
    expect(actions.every((a) => /^DAL-\d{3}$/.test(a.action_code) && a.library_version === 'DRM-v1.1')).toBe(true);
  });

  test('T-B02-031 every action and prompt passes the collection validators; a second run changes nothing', async () => {
    const db = await H.admin();
    const first = await seedReference(db);
    // the scratch database was rebuilt without seed, so the first run inserts everything (or nothing if already loaded)
    expect(first.actionsInserted + first.promptsInserted === 288 || first.actionsInserted + first.promptsInserted === 0).toBe(true);
    const second = await seedReference(db);
    expect(second).toEqual({ actionsInserted: 0, promptsInserted: 0 });
    expect(await db.collection('development_actions').countDocuments({})).toBe(216);
    expect(await db.collection('reflection_prompts').countDocuments({})).toBe(72);
    expect(await db.collection('development_actions').countDocuments({ active: true })).toBe(0);
    expect(await db.collection('interpretation_rules').countDocuments({})).toBeLessThan(1000);
  });

  test('T-B02-032 no question set is seeded', async () => {
    const db = await H.admin();
    const named = await db.collection('assessment_versions').countDocuments({ version_label: /^santulan-/ });
    expect(named).toBe(0);
  });
});
