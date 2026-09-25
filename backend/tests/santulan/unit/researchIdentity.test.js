/*
 * Research identity minimisation (AT-30, B08-065): the default projection exposes no direct-identity column; a withdrawn participant is
 * excluded by the default hook; the hook interface accepts an approved pseudonymisation policy later without changing the exporter.
 * The research views themselves are checked in store/views.test.js; the count reaching EXPORT_METADATA in integration/researchExport.test.js.
 */
const identity = require('../../../src/services/research/researchIdentity');
const { SHEETS } = require('../../../src/services/research/workbookWriter');

afterEach(() => identity.resetPolicy());

const row = (over = {}) => ({ santulan_id: 'STN-ABCDEFGHJKMNPQRSTVWX', participation_route: 'OPEN', participant_status: 'ACTIVE', ...over });

describe('the default research-safe projection', () => {
  test('no sheet of the workbook declares a direct-identity column', () => {
    for (const [sheet, def] of Object.entries(SHEETS)) {
      for (const column of Object.keys(def.columns)) expect({ sheet, column, forbidden: identity.FORBIDDEN_COLUMNS.has(column) }).toEqual({ sheet, column, forbidden: false });
    }
    expect(SHEETS.PARTICIPANTS.columns.santulan_id).toBeTruthy();
  });

  test('every direct-identity column is stripped even if a view ever emitted it', () => {
    const dirty = row({
      participant_id: 'p', auth_provider: 'x', auth_provider_subject_id: 'someone@example.org', external_student_id: 'S-1', email: 'a@b.c', mobile: '9', guardian_name: 'g', guardian_email: 'g@x.y',
      date_of_birth: '2010-01-01', full_name: 'A B',
    });
    const out = identity.project(dirty);
    expect(out).toEqual({ santulan_id: 'STN-ABCDEFGHJKMNPQRSTVWX', participation_route: 'OPEN', participant_status: 'ACTIVE' });
    for (const key of Object.keys(out)) expect(identity.FORBIDDEN_COLUMNS.has(key)).toBe(false);
  });

  test('the Santulan ID is left as it is (it is the opaque research identity)', () => {
    expect(identity.project(row()).santulan_id).toBe('STN-ABCDEFGHJKMNPQRSTVWX');
  });
});

describe('withdrawn participants (B08-065)', () => {
  test('a WITHDRAWN participant is excluded by the default hook; ACTIVE and SUSPENDED are kept', () => {
    expect(identity.project(row({ participant_status: 'WITHDRAWN' }))).toBeNull();
    expect(identity.project(row({ participant_status: 'ACTIVE' }))).not.toBeNull();
    expect(identity.project(row({ participant_status: 'SUSPENDED' }))).not.toBeNull();
    expect(identity.project({ version_label: 'x' })).not.toBeNull(); // a row without a participant (cohort / set metadata) is unaffected
  });
});

describe('the hook interface', () => {
  const pseudonymise = { name: 'test-pseudonym', version: '9', includeRow: () => true, mapRow: (r) => ({ ...r, santulan_id: r.santulan_id ? `PSEUDO-${r.santulan_id.slice(-4)}` : r.santulan_id }) };

  test('an approved policy with the same interface can replace the default; the exporter API does not change', () => {
    expect(identity.isPolicy(pseudonymise)).toBe(true);
    const previous = identity.setPolicy(pseudonymise);
    expect(previous.name).toBe('default-research-safe');
    expect(identity.getPolicy().name).toBe('test-pseudonym');
    expect(identity.project(row()).santulan_id).toBe('PSEUDO-TVWX');
    expect(identity.project(row({ participant_status: 'WITHDRAWN' }))).not.toBeNull(); // the policy decides who is included
  });

  test('a policy cannot reintroduce a direct-identity column: the projection strips after mapping too', () => {
    identity.setPolicy({ ...pseudonymise, mapRow: (r) => ({ ...r, email: 'leak@example.org', participant_id: 'p' }) });
    const out = identity.project(row());
    expect(out.email).toBeUndefined();
    expect(out.participant_id).toBeUndefined();
  });

  test('a malformed policy is refused and the current one stays in force', () => {
    for (const bad of [null, {}, { name: 'x', version: '1' }, { name: 'x', version: '1', includeRow: () => true }, 'policy']) expect(() => identity.setPolicy(bad)).toThrow();
    expect(identity.getPolicy().name).toBe('default-research-safe');
  });
});
