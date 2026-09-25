/* Evidence decision (B06-039..041, FR-049): S1 default; S2 only with the pilot-S2 switch; S3-S5 need the advanced switch AND configuration. */
const { decideEvidence } = require('../../../src/services/domain/scoringRules');
const { statesFor, EvidenceConfigError } = require('../../../src/services/scoring/evidenceConfig');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL_OFF = { pilotS2: false, advancedEvidence: false, developmentRelease: false, pathwayRelease: false };
const on = (o) => ({ ...ALL_OFF, ...o });

describe('B06-039 the default is S1', () => {
  test.each(['COMPLETE', 'COMPLETE_WITH_MISSING', 'INCOMPLETE'])('with every switch off, %s is S1', (status) => {
    expect(decideEvidence('C1', status, {}, ALL_OFF)).toBe('S1');
  });
  test('nothing configured and no switches given is S1', () => { expect(decideEvidence('C3', 'COMPLETE')).toBe('S1'); });
});

describe('B06-040 S2 needs the pilot-S2 switch AND usable completeness AND not held', () => {
  test('pilot-S2 on + COMPLETE or COMPLETE_WITH_MISSING (above 80 percent) -> S2', () => {
    expect(decideEvidence('C1', 'COMPLETE', {}, on({ pilotS2: true }))).toBe('S2');
    expect(decideEvidence('C1', 'COMPLETE_WITH_MISSING', {}, on({ pilotS2: true }))).toBe('S2');
  });
  test('exactly 80 percent (INCOMPLETE) is never S2, even with the switch on', () => {
    expect(decideEvidence('C1', 'INCOMPLETE', {}, on({ pilotS2: true }))).toBe('S1');
  });
  test('INSUFFICIENT is S0 whatever the switches say', () => {
    expect(decideEvidence('C1', 'INSUFFICIENT', {}, on({ pilotS2: true, advancedEvidence: true }))).toBe('S0');
    expect(decideEvidence('C1', 'INSUFFICIENT', { C1: 'SH' }, on({ pilotS2: true }))).toBe('S0');
  });
  test('a configured hold makes the domain SH; a configured pin keeps it S1', () => {
    expect(decideEvidence('C4', 'COMPLETE', { C4: 'SH' }, on({ pilotS2: true }))).toBe('SH');
    expect(decideEvidence('C4', 'COMPLETE', { C4: 'S1' }, on({ pilotS2: true }))).toBe('S1');
    expect(decideEvidence('C5', 'COMPLETE', { C4: 'SH' }, on({ pilotS2: true }))).toBe('S2'); // another domain is unaffected
  });
  test('an incomplete domain can still be held', () => {
    expect(decideEvidence('C2', 'INCOMPLETE', { C2: 'SH' }, ALL_OFF)).toBe('SH');
  });
});

describe('B06-041 S3-S5 need the advanced-evidence switch AND governed configuration', () => {
  test('the advanced switch alone never promotes', () => {
    expect(decideEvidence('C1', 'COMPLETE', {}, on({ advancedEvidence: true }))).toBe('S1');
    expect(decideEvidence('C1', 'COMPLETE', {}, on({ advancedEvidence: true, pilotS2: true }))).toBe('S2');
  });
  test('configuration alone never promotes past what the switches allow', () => {
    expect(decideEvidence('C1', 'COMPLETE', { C1: 'S3' }, ALL_OFF)).toBe('S1');
    expect(decideEvidence('C1', 'COMPLETE', { C1: 'S4' }, on({ pilotS2: true }))).toBe('S2');
  });
  test('both together assign S3, S4 or S5 for usable domains only', () => {
    for (const s of ['S3', 'S4', 'S5']) expect(decideEvidence('C1', 'COMPLETE', { C1: s }, on({ advancedEvidence: true }))).toBe(s);
    expect(decideEvidence('C1', 'INCOMPLETE', { C1: 'S3' }, on({ advancedEvidence: true }))).toBe('S1');
  });
});

describe('the evidence configuration file (EVIDENCE_CONFIG_PATH) can hold or pin but never promote', () => {
  const write = (obj) => { const p = path.join(os.tmpdir(), `evidence-${Date.now()}-${Math.random()}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  test('SH, S1 and S3-S5 are accepted for a known domain', () => {
    const p = write({ 'set-1': { C1: 'SH', C2: 'S1', C3: 'S3' } });
    expect(statesFor('set-1', p)).toEqual({ C1: 'SH', C2: 'S1', C3: 'S3' });
    expect(statesFor('another-set', p)).toEqual({}); // not configured for this set: nothing
  });
  test('S2 and S0 fail closed (a file can never promote to S2, and S0 cannot be configured)', () => {
    expect(() => statesFor('set-1', write({ 'set-1': { C1: 'S2' } }))).toThrow(EvidenceConfigError);
    expect(() => statesFor('set-1', write({ 'set-1': { C1: 'S0' } }))).toThrow(EvidenceConfigError);
    expect(() => statesFor('set-1', write({ 'set-1': { C9: 'SH' } }))).toThrow(EvidenceConfigError);
  });
  test('no path, a missing file or a set without an entry configures nothing', () => {
    expect(statesFor('set-1', '')).toEqual({});
    expect(statesFor('set-1', path.join(os.tmpdir(), 'no-such-evidence-file.json'))).toEqual({});
  });
});
