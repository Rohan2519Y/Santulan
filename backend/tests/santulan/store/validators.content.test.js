/* Content collections, runtime credential (G-01, G-04, G-28 shape; T-B02, CR-006 option tests). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

afterAll(async () => { await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);
const V = () => F.versionDoc();

describe('G-04 assessment_versions (question sets)', () => {
  test('T-B02-001 configuration and age range must agree', async () => {
    expect(await ok('assessment_versions', V())).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ configuration: 'EMERGING_ADULT', participant_min_age: 18, participant_max_age: 25 }))).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ configuration: 'ADOLESCENT', participant_min_age: 13, participant_max_age: 25 }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ configuration: 'EMERGING_ADULT', participant_min_age: 13, participant_max_age: 17 }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ configuration: 'TEEN' }))).toBe(false);
  });

  test('T-B02-002 status must be DRAFT, FROZEN or RETIRED; FROZEN needs frozen_at', async () => {
    expect(await ok('assessment_versions', F.versionDoc({ status: 'ARCHIVED' }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: null }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ status: 'FROZEN', frozen_at: new Date() }))).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ status: 'RETIRED' }))).toBe(true);
  });

  test('T-B02-003 participation_state OPEN requires a FROZEN set', async () => {
    expect(await ok('assessment_versions', F.versionDoc({ participation_state: 'OPEN', status: 'DRAFT' }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ participation_state: 'OPEN', status: 'FROZEN', frozen_at: new Date() }))).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ participation_state: 'CLOSED', status: 'DRAFT' }))).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ participation_state: 'PAUSED', status: 'DRAFT' }))).toBe(true);
  });

  test('T-B02-004 revision is an integer >= 1; label pattern; hashes are 64 hex', async () => {
    expect(await ok('assessment_versions', F.versionDoc({ revision: 0 }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ revision: 2 }))).toBe(true);
    for (const label of ['A', 'Has Space', 'UPPER-1', '-lead', 'ab']) {
      expect(await ok('assessment_versions', F.versionDoc({ version_label: label }))).toBe(false);
    }
    expect(await ok('assessment_versions', F.versionDoc({ version_label: 'adolescent-v3.1_a' }))).toBe(true);
    expect(await ok('assessment_versions', F.versionDoc({ content_hash: 'abc' }))).toBe(false);
    expect(await ok('assessment_versions', F.versionDoc({ source_file_hash: 'G'.repeat(64) }))).toBe(false);
  });

  test('G-04 a question set has no response_scale_id (CR-006-3)', async () => {
    expect(await ok('assessment_versions', { ...V(), response_scale_id: F.institution()._id })).toBe(false);
  });
});

describe('G-04 items (questions with options)', () => {
  const vid = F.versionDoc()._id;
  test('T-B02-010 a valid five-option question is accepted', async () => {
    expect(await ok('items', F.item(vid))).toBe(true);
  });
  test('T-B02-011 options: between 2 and 20 entries', async () => {
    for (const n of [2, 3, 9, 20]) expect(await ok('items', F.item(vid, { options: F.options(n) }))).toBe(true);
    expect(await ok('items', F.item(vid, { options: F.options(1) }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: F.options(21) }))).toBe(false);
  });
  test('T-B02-012 option text 1..200 characters and distinct', async () => {
    const o = F.options(3);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: '' }, o[1], o[2]] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: 'x'.repeat(201) }, o[1], o[2]] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: 'x'.repeat(200) }, o[1], o[2]] }))).toBe(true);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: 'Same' }, { position: 2, text: 'Same' }, o[2]] }))).toBe(false);
  });
  test('T-B02-013 positions run 1..n in order', async () => {
    const o = F.options(3);
    expect(await ok('items', F.item(vid, { options: [{ position: 2, text: 'A' }, { position: 1, text: 'B' }, o[2]] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: 'A' }, { position: 2, text: 'B' }, { position: 4, text: 'C' }] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [{ position: 0, text: 'A' }, { position: 1, text: 'B' }] }))).toBe(false);
    expect(await ok('items', F.item(vid, { options: [{ position: 1, text: 'A', extra: 1 }, { position: 2, text: 'B' }] }))).toBe(false);
  });
  test('T-B02-014 domain, subdomain, age band, context, layer, order and status', async () => {
    expect(await ok('items', F.item(vid, { domain_code: 'C8' }))).toBe(false);
    expect(await ok('items', F.item(vid, { subdomain_code: 'C4.6', domain_code: 'C4' }))).toBe(false);
    expect(await ok('items', F.item(vid, { domain_code: 'C2', subdomain_code: 'C1.1' }))).toBe(false); // subdomain belongs to another domain
    expect(await ok('items', F.item(vid, { domain_code: 'C7', subdomain_code: 'C7A.1' }))).toBe(true);
    expect(await ok('items', F.item(vid, { domain_code: 'C7', subdomain_code: 'C1.1' }))).toBe(false);
    expect(await ok('items', F.item(vid, { age_band: '12-17' }))).toBe(false);
    for (const b of ['13–17', '18–25', '13–25']) expect(await ok('items', F.item(vid, { age_band: b }))).toBe(true);
    expect(await ok('items', F.item(vid, { context: 'Home' }))).toBe(false);
    for (const c of ['General', 'School', 'College/Work', 'Digital']) expect(await ok('items', F.item(vid, { context: c }))).toBe(true);
    expect(await ok('items', F.item(vid, { layer: 'X' }))).toBe(false);
    expect(await ok('items', F.item(vid, { display_order: 0 }))).toBe(false);
    expect(await ok('items', F.item(vid, { status: 'DRAFT' }))).toBe(false);
    expect(await ok('items', F.item(vid, { keying: 'NEGATIVE' }))).toBe(false);
    expect(await ok('items', F.item(vid, { item_code: 'C1-1' }))).toBe(false);
  });
});

describe('G-28 interpretation_rules', () => {
  const vid = F.versionDoc()._id;
  test('G-28 layer is required and must be one of the seven layers', async () => {
    for (const layer of ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'PRIORITY', 'ACTION']) {
      expect(await ok('interpretation_rules', F.rule(vid, { layer }))).toBe(true);
    }
    expect(await ok('interpretation_rules', F.rule(vid, { layer: 'OTHER' }))).toBe(false);
    const noLayer = F.rule(vid);
    delete noLayer.layer;
    expect(await ok('interpretation_rules', noLayer)).toBe(false);
  });
  test('G-28 wording must not be blank; status and evidence enums', async () => {
    expect(await ok('interpretation_rules', F.rule(vid, { approved_text_template: '  ' }))).toBe(false);
    expect(await ok('interpretation_rules', F.rule(vid, { status: 'PUBLISHED' }))).toBe(false);
    expect(await ok('interpretation_rules', F.rule(vid, { evidence_state: 'S9' }))).toBe(false);
    expect(await ok('interpretation_rules', F.rule(vid, { developmental_band: 'D2' }))).toBe(true);
  });
});

describe('reference content', () => {
  test('T-B02-020 development actions and reflection prompts keep their shape', async () => {
    const action = {
      _id: F.hex('a').slice(0, 8) + '-0000-4000-8000-000000000001', action_code: 'FX-DAL-001', library_version: 'FX-v1', domain_code: 'C1', subdomain_code: 'C1.1',
      progression_level: 'Foundation', action_text: 'x', age_band: '13-17', action_type: null, duration_minutes: 5, practice_window: null, evidence_status: 'x',
      control_flags: {}, active: false, created_at: new Date(),
    };
    expect(await ok('development_actions', action)).toBe(true);
    expect(await ok('development_actions', { ...action, subdomain_code: 'C2.1' })).toBe(false);
    expect(await ok('development_actions', { ...action, duration_minutes: -1 })).toBe(false);
    expect(await ok('development_actions', { ...action, progression_level: 'Expert' })).toBe(false);
    const prompt = {
      _id: F.hex('p').slice(0, 8) + '-0000-4000-8000-000000000002', prompt_code: 'FX-RP-1', domain_code: 'C1', subdomain_code: null, prompt_text: 'x', age_band: '13-17', sequence: 1,
      version: 'v1', status: 'DRAFT', created_at: new Date(),
    };
    expect(await ok('reflection_prompts', prompt)).toBe(true);
    expect(await ok('reflection_prompts', { ...prompt, sequence: 0 })).toBe(false);
  });
});
