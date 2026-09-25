/*
 * Deterministic report renderer (B07-003, B07-026..035, RC-11, AT-19; SC-017, SC-018; BUILD 07 sections 4, 7, 8, 9). Pure functions: no database.
 */
const { renderSections, profilePayload } = require('../../../src/services/reporting/reportRenderer');
const rulesLib = require('../../../src/services/domain/reportRules');
const { T11_UNDER_REVIEW, T12_NOT_ELIGIBLE } = require('../../../src/services/reporting/messages');
const { scanClaims } = require('../helpers/claimsScanner');

const DOMAIN_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const domain = (code, i, over = {}) => ({ code, score: 1.5 + i * 0.5, state: 'S2', completeness: 1, completenessStatus: 'COMPLETE', ...over });
const domains = (overrides = {}) => DOMAIN_CODES.map((code, i) => domain(code, i, overrides[code] || {}));
const context = { questionSet: 'pilot-set', revision: 2, developmentalBand: 'D2', assessedOn: '2026-09-20' };
const LAYERS = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'];
const rule = (layer, dom, text, extra = {}) => ({ layer, domainCode: dom, developmentalBand: null, evidenceState: 'S2', locale: 'en', approvedTextTemplate: text, version: 'v1', ...extra });
const fullRules = (list = DOMAIN_CODES, extra = {}) => list.flatMap((d) => LAYERS.map((l) => rule(l, d, `${l} ${d}`, extra)));
const input = (over = {}) => ({ domains: domains(), context, band: 'D2', rules: fullRules(), actionsByDomain: {}, hasPriorAttempt: false, ...over });

describe('reproducibility (B07-003, RC-11, AT-19)', () => {
  const actionsByDomain = { C1: [{ code: 'DAL-001', version: 'DRM-v1.1', text: 'Notice one signal of tiredness.' }] };
  const rules = [...fullRules(), rule('PRIORITY', 'C1', 'Priority C1')];

  test('B07-003 the same frozen inputs render byte-identical snapshots and the same content_hash, however the inputs are ordered', () => {
    const a = renderSections(input({ rules, actionsByDomain }));
    const b = renderSections(input({ rules: [...rules].reverse(), domains: [...domains()].reverse(), actionsByDomain }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(renderSections(input({ rules, actionsByDomain })))).toBe(JSON.stringify(a));
    expect(rulesLib.fingerprint(a)).toBe(rulesLib.fingerprint(b));
    expect(rulesLib.fingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('display_order is contiguous 1..N and starts with the PROFILE; descriptive layers come before the hidden prescriptive ones', () => {
    const sections = renderSections(input({ rules, actionsByDomain }));
    expect(sections.map((s) => s.displayOrder)).toEqual(sections.map((_, i) => i + 1));
    expect(sections[0]).toMatchObject({ sectionType: 'PROFILE', domainCode: null, contentVersion: 'profile-v1', locale: 'en', released: true });
    const types = sections.map((s) => s.sectionType);
    expect(types.lastIndexOf('GROWTH')).toBeLessThan(types.indexOf('PRIORITY'));
    expect(types.indexOf('PRIORITY')).toBeLessThan(types.indexOf('ACTION'));
    expect(sections.filter((s) => ['PRIORITY', 'ACTION'].includes(s.sectionType)).every((s) => s.released === false)).toBe(true);
    expect(sections.filter((s) => !['PRIORITY', 'ACTION'].includes(s.sectionType)).every((s) => s.released === true)).toBe(true);
  });

  test('a different governed content version changes the snapshot AND the fingerprint (no silent reuse of an older one)', () => {
    const v1 = renderSections(input({ rules }));
    const v2 = renderSections(input({ rules: rules.map((r) => ({ ...r, version: 'v2', approvedTextTemplate: `${r.approvedTextTemplate} (v2)` })) }));
    expect(JSON.stringify(v1)).not.toBe(JSON.stringify(v2));
    expect(v2.find((s) => s.sectionType === 'MEANING').contentVersion).toBe('v2');
    expect(rulesLib.fingerprint(v1)).not.toBe(rulesLib.fingerprint(v2));
  });
});

describe('the PROFILE payload (scoring-and-report section 7; B07-035)', () => {
  const profile = (over) => JSON.parse(renderSections(input(over))[0].contentSnapshot);

  test('scale 1-5, a context snapshot with no identity or route, and exactly seven domains C1-C7 in order, each with its full label', () => {
    const p = profile();
    expect(p.scale).toEqual({ min: 1, max: 5 });
    expect(p.context).toEqual({ questionSet: 'pilot-set', revision: 2, developmentalBand: 'D2', assessedOn: '2026-09-20' });
    expect(JSON.stringify(p.context)).not.toMatch(/name|birth|email|mobile|route|institution|santulan_id|participant/i);
    expect(p.domains.map((d) => d.code)).toEqual(DOMAIN_CODES);
    expect(p.domains[0].name).toBe('Body & Self-Regulation');
    expect(p.domains.every((d) => typeof d.name === 'string' && d.name.length > 3)).toBe(true);
  });

  test('a plotted domain carries a score to two decimals, its completeness and completeness status', () => {
    const p = profile({ domains: domains({ C1: { score: 3.3333333, completeness: 0.9, completenessStatus: 'COMPLETE_WITH_MISSING' } }) });
    expect(p.domains[0]).toEqual({ code: 'C1', name: 'Body & Self-Regulation', display: 'PLOTTED', score: 3.33, completeness: 0.9, completenessStatus: 'COMPLETE_WITH_MISSING' });
  });

  test('B07-035 an unreportable, incomplete or missing domain is NOT_ENOUGH_DATA with a null score - never plotted at 1.00', () => {
    const list = domains({
      C1: { score: null, state: 'S0', completenessStatus: 'INSUFFICIENT' }, C2: { state: 'S1' }, C3: { state: 'SH' },
      C4: { completenessStatus: 'INCOMPLETE' }, C5: { score: 1, state: 'S2', completenessStatus: 'INSUFFICIENT' },
    }).filter((d) => d.code !== 'C7');
    const p = profile({ domains: list });
    const byCode = Object.fromEntries(p.domains.map((d) => [d.code, d]));
    for (const code of ['C1', 'C2', 'C3', 'C4', 'C5', 'C7']) {
      expect(byCode[code]).toMatchObject({ display: 'NOT_ENOUGH_DATA', score: null, completeness: null, completenessStatus: null, message: 'Not enough data yet' });
    }
    expect(byCode.C6.display).toBe('PLOTTED');
    expect(p.domains).toHaveLength(7);
    expect(JSON.stringify(p)).not.toMatch(/"score":1(\.0+)?[,}]/);
  });

  test('the payload carries no subdomain score, band label, percentile, norm, benchmark or reliable-change string', () => {
    const text = JSON.stringify(profilePayload({ domains: domains(), context }));
    expect(text).not.toMatch(/subdomain|percentile|norm|benchmark|\b(low|average|high)\b|reliable|improv|C\d\.\d/i);
    expect(scanClaims(text)).toEqual([]);
  });
});

describe('approved content only and fail closed (BUILD 07 section 8; B07-026..033, 078)', () => {
  test('with no reportable domain only the PROFILE exists, and no wording is needed', () => {
    const list = domains({ C1: { state: 'S1' }, C2: { state: 'S0', score: null, completenessStatus: 'INSUFFICIENT' }, C3: { state: 'SH' }, C4: { completenessStatus: 'INCOMPLETE' }, C5: { state: 'S1' }, C6: { state: 'S1' }, C7: { state: 'S1' } });
    const sections = renderSections(input({ domains: list, rules: [] }));
    expect(sections.map((s) => s.sectionType)).toEqual(['PROFILE']);
  });

  test('S0 / S1 / SH / INCOMPLETE / INSUFFICIENT domains get no interpretation and no failure even when a rule exists for them', () => {
    const list = domains({ C1: { state: 'S1' }, C2: { state: 'S0', score: null, completenessStatus: 'INSUFFICIENT' }, C3: { state: 'SH' }, C4: { completenessStatus: 'INCOMPLETE' } });
    const rules = [...fullRules(['C1', 'C2', 'C3', 'C4'], { evidenceState: 'S1' }), ...fullRules(['C5', 'C6', 'C7'])];
    const sections = renderSections(input({ domains: list, rules }));
    expect([...new Set(sections.filter((s) => s.sectionType !== 'PROFILE').map((s) => s.domainCode))]).toEqual(['C5', 'C6', 'C7']);
  });

  test('B07-078 an S2+ domain with no approved wording for a required layer FAILS THE WHOLE REPORT CLOSED (WORDING_MISSING)', () => {
    for (const missing of LAYERS) {
      const rules = fullRules().filter((r) => !(r.domainCode === 'C3' && r.layer === missing));
      expect(() => renderSections(input({ rules }))).toThrow(expect.objectContaining({ code: 'WORDING_MISSING', status: 500 }));
    }
    expect(() => renderSections(input({ rules: [] }))).toThrow(expect.objectContaining({ code: 'WORDING_MISSING' }));
  });

  test('wording for another evidence state, locale or an unapproved shape is never used; the failure carries internal detail only', () => {
    const rules = fullRules().map((r) => (r.domainCode === 'C1' && r.layer === 'MEANING' ? { ...r, evidenceState: 'S3' } : r));
    let caught;
    try { renderSections(input({ rules })); } catch (err) { caught = err; }
    expect(caught.code).toBe('WORDING_MISSING');
    expect(caught.detail).toMatchObject({ layer: 'MEANING', domain: 'C1', state: 'S2' });
    expect(caught.message).not.toMatch(/C1|MEANING/); // participant-facing message names nothing
    expect(() => renderSections(input({ rules: fullRules(DOMAIN_CODES, { locale: 'hi' }) }))).toThrow(expect.objectContaining({ code: 'WORDING_MISSING' }));
  });

  test('a band-specific wording wins over a band-less one; the band-less one is the fallback', () => {
    const rules = [...fullRules(), rule('MEANING', 'C1', 'plain D1 variant', { developmentalBand: 'D1', version: 'v9' }), rule('MEANING', 'C2', 'other band', { developmentalBand: 'D3' })];
    expect(rulesLib.pickWording(rules, { layer: 'MEANING', domain: 'C1', state: 'S2', band: 'D1' }).approvedTextTemplate).toBe('plain D1 variant');
    expect(rulesLib.pickWording(rules, { layer: 'MEANING', domain: 'C1', state: 'S2', band: 'D3' }).approvedTextTemplate).toBe('MEANING C1');
    expect(rulesLib.pickWording(rules, { layer: 'MEANING', domain: 'C2', state: 'S2', band: 'D1' }).approvedTextTemplate).toBe('MEANING C2'); // never the D3 variant
    expect(rulesLib.pickWording(rules, { layer: 'MEANING', domain: 'C1', state: 'S4', band: 'D1' })).toBeNull();
    const d1 = renderSections(input({ rules, band: 'D1', context: { ...context, developmentalBand: 'D1' } }));
    expect(d1.find((s) => s.sectionType === 'MEANING' && s.domainCode === 'C1')).toMatchObject({ contentSnapshot: 'plain D1 variant', contentVersion: 'v9' });
  });

  test('CHANGE appears only when an earlier scored attempt exists, and only from approved wording (descriptive, never a reliable-change claim)', () => {
    const rules = [...fullRules(), ...DOMAIN_CODES.map((d) => rule('CHANGE', d, `Change ${d}`))];
    expect(renderSections(input({ rules, hasPriorAttempt: false })).some((s) => s.sectionType === 'CHANGE')).toBe(false);
    const withPrior = renderSections(input({ rules, hasPriorAttempt: true }));
    expect(withPrior.filter((s) => s.sectionType === 'CHANGE').map((s) => s.domainCode)).toEqual(DOMAIN_CODES);
    expect(() => renderSections(input({ rules: fullRules(), hasPriorAttempt: true }))).toThrow(expect.objectContaining({ code: 'WORDING_MISSING' })); // a required layer without wording still fails closed
  });

  test('the prescriptive layers use only approved PRIORITY wording and ACTIVE library actions, are hidden, and never fail the report', () => {
    const none = renderSections(input({ actionsByDomain: { C1: [] } }));
    expect(none.some((s) => ['PRIORITY', 'ACTION'].includes(s.sectionType))).toBe(false);
    const sections = renderSections(input({ rules: [...fullRules(), rule('PRIORITY', 'C2', 'Priority C2')], actionsByDomain: { C2: [{ code: 'DAL-010', version: 'DRM-v1.1', text: 'Try one thing.' }] } }));
    const action = sections.find((s) => s.sectionType === 'ACTION');
    expect(action).toMatchObject({ domainCode: 'C2', contentVersion: 'DRM-v1.1', released: false });
    expect(JSON.parse(action.contentSnapshot)).toEqual({ actions: [{ code: 'DAL-010', version: 'DRM-v1.1', text: 'Try one thing.' }] });
    expect(sections.find((s) => s.sectionType === 'PRIORITY')).toMatchObject({ domainCode: 'C2', contentSnapshot: 'Priority C2', released: false });
  });

  test('no rendered section contains a subdomain score, band label, percentile, norm or reliable-change claim', () => {
    const sections = renderSections(input());
    expect(scanClaims(sections.map((s) => s.contentSnapshot).join(' '))).toEqual([]);
  });
});

describe('neutral terminal copy (BUILD 07 sections 5-6)', () => {
  test('T11 and T12 are single fixed strings that name no flag, severity or reason', () => {
    expect(T11_UNDER_REVIEW).toBe('Your responses are being reviewed.');
    expect(T12_NOT_ELIGIBLE).toBe('This attempt could not be processed for a report.');
    for (const copy of [T11_UNDER_REVIEW, T12_NOT_ELIGIBLE]) expect(copy).not.toMatch(/Q\d\d|flag|severity|safeguard|risk|duplicate|version/i);
  });
});
