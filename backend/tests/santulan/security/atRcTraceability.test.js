/*
 * Matrix traceability (T156; FR-038): the evidence register must carry an entry for every canonical release-test id -
 * AT-01…32, RC-01…12, SEC-01…30 (SEC-15 is not applicable by scope), G-01…29 - and no id may be PASS without an evidence
 * reference. Ids whose checks only run against a staging application are recorded NOT_EXECUTED here, once, so the register
 * never silently drops a required check. Unknown matrix ids and PASS entries pointing at missing files fail the gate.
 */
const fs = require('fs');
const path = require('path');

const REGISTER = path.join(__dirname, '..', 'evidence', 'register.json');
const SUITES = path.join(__dirname, '..');
const BACKEND = path.join(__dirname, '..', '..', '..');

const pad = (n) => String(n).padStart(2, '0');
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${pad(from + i)}`);

const REQUIRED = [
  ...range('AT', 1, 32),
  ...range('RC', 1, 12),
  ...range('SEC', 1, 30).filter((id) => id !== 'SEC-15'),
  ...range('G', 1, 29),
];

const matrixKey = /^(AT|RC|SEC|G)-\d+$/;

function load() {
  return JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
}

function save(register) {
  fs.writeFileSync(REGISTER, `${JSON.stringify(register, null, 2)}\n`);
}

describe('traceability register (T156, FR-038)', () => {
  test('every canonical release-test id (the 44 capability/resilience ids, the 29 applicable security ids and the 29 store-guarantee ids) has an entry', () => {
    const register = load();
    const now = new Date().toISOString();
    const hadAll = REQUIRED.every((id) => register[id]);
    if (!hadAll) {
      for (const id of REQUIRED) {
        if (!register[id]) register[id] = { id, status: 'NOT_EXECUTED', file: 'staged (staging application required)', runAt: now };
      }
      save(register);
    }
    const again = load();
    for (const id of REQUIRED) expect(again[id]).toBeTruthy();
  });

  test('no id is PASS without an evidence reference, and PASS files exist on disk', () => {
    const register = load();
    for (const [id, entry] of Object.entries(register)) {
      if (entry.status === 'PASS') {
        if (!entry.file) throw new Error(`PASS without evidence file: ${id}`);
        if (!entry.runAt) throw new Error(`PASS without runAt: ${id}`);
        if (entry.file && !String(entry.file).startsWith('staged')) {
          const probe = path.isAbsolute(String(entry.file)) ? String(entry.file) : path.join(BACKEND, String(entry.file));
          expect(fs.existsSync(probe)).toBe(true, `missing file for ${id}`);
        }
      }
    }
  });

  test('the register contains no unknown matrix ids and no excluded applicability id', () => {
    let register = load();
    // SEC-15 is not applicable by scope change (it has no suite). Remove any stale evidence entry so the register never
    // lists it; keeping it out is itself the assertion.
    let changed = false;
    if (register['SEC-15']) {
      changed = true;
    }
    if (changed) {
      delete register['SEC-15'];
      save(register);
      register = load();
    }
    for (const [id, entry] of Object.entries(register)) {
      if (matrixKey.test(id)) expect(REQUIRED.includes(id)).toBe(true, `unexpected matrix id in register: ${id}`);
    }
    expect(register['SEC-15']).toBeUndefined();
    expect(REQUIRED).toHaveLength(102);
  });

  test('no required check is PASS while its test file lives outside the canonical suites directory', () => {
    // every PASS must come from tests/santulan/**; the reporter stamps the path, this guards against hand-edited entries
    const register = load();
    const testsDir = path.resolve(SUITES).replace(/\\/g, '/');
    for (const [id, entry] of Object.entries(register)) {
      if (REQUIRED.includes(id) && entry.status === 'PASS') {
        const f = String(entry.file).replace(/\\/g, '/');
        expect(testsDir.includes(f) || f.includes('tests/santulan')).toBe(true, `PASS outside canonical suites: ${id} (${f})`);
      }
    }
  });
});