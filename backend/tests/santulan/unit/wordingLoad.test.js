/*
 * Governed wording loader (scripts/wording-load.js; T130): validation, DRAFT insertion, audited approval, the unique approved rule per
 * dimension, nothing below S2. Runs against the SCRATCH database with the migrator credential (as the script does).
 */
const { loadWording, validateWordingFile, ruleCode, WordingFileError } = require('../../../scripts/wording-load');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/modules/santulan/store/client');

let S;
let client;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1, open: false }); client = await H.rawAdminClient(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const rule = (over = {}) => ({ domain: 'C1', band: null, evidenceState: 'S2', locale: 'en', layer: 'MEANING', version: 'wl-v1', text: 'Approved wording.', ...over });
const file = (rules, over = {}) => ({ questionSet: S.label, revision: 1, rules, ...over });
const load = (spec, opts) => loadWording(client, H.DB_NAME, spec, opts);
const stored = async (filter = {}) => (await H.admin()).collection('interpretation_rules').find({ assessment_version_id: S.setId, ...filter }).toArray();
afterEach(async () => { await (await H.admin()).collection('interpretation_rules').deleteMany({ assessment_version_id: S.setId }); });

describe('file validation', () => {
  test('a valid file normalises; every problem is reported at once', () => {
    expect(validateWordingFile(file([rule({ band: 'D1' }), rule({ layer: 'GROWTH' })])).rules).toHaveLength(2);
    expect(() => validateWordingFile(file([rule({ domain: 'C9', evidenceState: 'S1', layer: 'NOTES', text: ' ', version: '', locale: '', band: 'D9' })]))).toThrow(WordingFileError);
    try { validateWordingFile(file([rule({ domain: 'C9', evidenceState: 'S1', layer: 'NOTES', text: ' ', version: '', locale: '', band: 'D9' })])); } catch (e) {
      for (const m of ['domain', 'band', 'evidenceState', 'locale', 'layer', 'version', 'text']) expect(e.message).toContain(m);
    }
  });

  test('nothing below S2 can be loaded: S0, S1 and SH are refused', () => {
    for (const evidenceState of ['S0', 'S1', 'SH']) expect(() => validateWordingFile(file([rule({ evidenceState })]))).toThrow(/evidenceState/);
    for (const evidenceState of ['S2', 'S3', 'S4', 'S5']) expect(() => validateWordingFile(file([rule({ evidenceState })]))).not.toThrow();
  });

  test('a missing set, revision or rules, an empty list and a repeated rule are refused', () => {
    for (const bad of [null, [], 'x', file([]), { rules: [rule()] }, file([rule()], { revision: 0 }), file([rule(), rule()])]) expect(() => validateWordingFile(bad)).toThrow(WordingFileError);
  });
});

describe('loading', () => {
  test('rules are inserted as DRAFT with a deterministic code and id; a re-run changes nothing; nothing is approved without --approve', async () => {
    const spec = file([rule(), rule({ layer: 'PATTERN' }), rule({ domain: 'C2', band: 'D2' })]);
    expect(await load(spec)).toMatchObject({ setId: S.setId, inserted: 3, existing: 0, approved: 0 });
    const rows = await stored();
    expect(rows.map((r) => [r.rule_code, r.status]).sort()).toEqual([[ruleCode(rule()), 'DRAFT'], [ruleCode(rule({ layer: 'PATTERN' })), 'DRAFT'], [ruleCode(rule({ domain: 'C2', band: 'D2' })), 'DRAFT']].sort());
    expect(rows.every((r) => r.assessment_version_id === S.setId && r.version === 'wl-v1' && r.locale === 'en')).toBe(true);
    expect(await load(spec)).toMatchObject({ inserted: 0, existing: 3, approved: 0 });
    expect(await stored()).toHaveLength(3);
  });

  test('an unknown question set or revision is refused; the same version with different text is refused (load a new version instead)', async () => {
    await expect(load(file([rule()], { questionSet: 'no-such-set' }))).rejects.toThrow(/not found/);
    await expect(load(file([rule()], { revision: 7 }))).rejects.toThrow(/not found/);
    await load(file([rule()]));
    await expect(load(file([rule({ text: 'Changed wording.' })]))).rejects.toThrow(/different text/);
    expect(await stored()).toHaveLength(1);
    expect((await load(file([rule({ text: 'Changed wording.', version: 'wl-v2' })]))).inserted).toBe(1);
  });
});

describe('approval (--approve)', () => {
  test('approves each rule with one audit row, idempotently', async () => {
    const spec = file([rule(), rule({ layer: 'GROWTH' })]);
    expect(await load(spec, { approve: true })).toMatchObject({ inserted: 2, approved: 2, alreadyApproved: 0 });
    expect((await stored()).every((r) => r.status === 'APPROVED')).toBe(true);
    const audit = await (await H.admin()).collection('audit_logs').find({ action_type: 'WORDING_APPROVED', target_id: { $in: (await stored()).map((r) => r._id) } }).toArray();
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actor_type: 'SYSTEM', target_entity: 'interpretation_rules', previous_state: { status: 'DRAFT' } });
    expect(await load(spec, { approve: true })).toMatchObject({ inserted: 0, approved: 0, alreadyApproved: 2 });
    expect(await (await H.admin()).collection('audit_logs').countDocuments({ action_type: 'WORDING_APPROVED', target_id: { $in: (await stored()).map((r) => r._id) } })).toBe(2);
  });

  test('a second approved wording for the same dimension is refused, and the second rule stays DRAFT with no approval audit', async () => {
    await load(file([rule()]), { approve: true });
    await expect(load(file([rule({ version: 'wl-v2', text: 'A newer wording.' })]), { approve: true })).rejects.toThrow(/second approved wording/);
    const second = (await stored({ version: 'wl-v2' }))[0];
    expect(second.status).toBe('DRAFT');
    expect(await (await H.admin()).collection('audit_logs').countDocuments({ action_type: 'WORDING_APPROVED', target_id: second._id })).toBe(0);
    expect((await stored({ status: 'APPROVED' }))).toHaveLength(1);
  });

  test('a different locale or band is a different dimension and can be approved alongside', async () => {
    await load(file([rule()]), { approve: true });
    expect(await load(file([rule({ locale: 'hi', version: 'wl-v1' }), rule({ band: 'D1' })]), { approve: true })).toMatchObject({ approved: 2 });
    expect(await stored({ status: 'APPROVED' })).toHaveLength(3);
  });

  test('a retired rule is never re-approved by loading', async () => {
    await load(file([rule()]), { approve: true });
    await (await H.admin()).collection('interpretation_rules').updateMany({ assessment_version_id: S.setId }, { $set: { status: 'RETIRED' } });
    await expect(load(file([rule()]), { approve: true })).rejects.toThrow(/retired/);
  });
});
