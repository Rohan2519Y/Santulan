/*
 * Research identity minimisation (AT-30, B08-065): the default projection exposes no direct-identity column and replaces
 * santulan_id with a stable, deterministic participant_research_id pseudonym; a withdrawn participant is excluded by the
 * default hook; the hook interface accepts an approved pseudonymisation policy later without changing the exporter.
 * The research views themselves are checked in store/views.test.js; the workbook this feeds integration/researchExport.test.js.
 */
const identity = require('../../../src/services/research/researchIdentity');

afterEach(() => identity.resetPolicy());

const row = (over = {}) => ({ santulan_id: 'STN-ABCDEFGHJKMNPQRSTVWX', participation_route: 'OPEN', participant_status: 'ACTIVE', ...over });

describe('the default research-safe projection', () => {
  test('every direct-identity column is stripped even if a view ever emitted it', () => {
    const dirty = row({
      participant_id: 'p', auth_provider: 'x', auth_provider_subject_id: 'someone@example.org', external_student_id: 'S-1', email: 'a@b.c', mobile: '9', guardian_name: 'g', guardian_email: 'g@x.y',
      date_of_birth: '2010-01-01', full_name: 'A B',
    });
    const out = identity.project(dirty);
    expect(out).toEqual({ participant_research_id: identity.participantResearchId('STN-ABCDEFGHJKMNPQRSTVWX'), participation_route: 'OPEN', participant_status: 'ACTIVE' });
    for (const key of Object.keys(out)) expect(identity.FORBIDDEN_COLUMNS.has(key)).toBe(false);
  });

  test('the Santulan ID is replaced by a stable, deterministic pseudonym - never left as it is', () => {
    const out = identity.project(row());
    expect(out.santulan_id).toBeUndefined();
    expect(out.participant_research_id).toBe(identity.participantResearchId('STN-ABCDEFGHJKMNPQRSTVWX'));
    expect(out.participant_research_id).toMatch(/^PR-\d{6}$/);
    expect(identity.project(row()).participant_research_id).toBe(out.participant_research_id); // same input, same pseudonym
    expect(identity.project(row({ santulan_id: 'STN-OTHERSANTULANIDXXXX' })).participant_research_id).not.toBe(out.participant_research_id);
  });

  test('a row without santulan_id (cohort/set metadata) is unaffected by the pseudonymisation step', () => {
    expect(identity.project({ version_label: 'x' })).toEqual({ version_label: 'x' });
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
