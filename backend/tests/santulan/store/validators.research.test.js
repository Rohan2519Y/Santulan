/* research_exports, audit_logs, dev_identity_credentials (G-01). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

afterAll(async () => { await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);
const adminId = F.admin()._id;
const vid = F.versionDoc()._id;

describe('research_exports', () => {
  test('B08-030 READY needs a file reference; FAILED has none', async () => {
    expect(await ok('research_exports', F.researchExport(adminId, vid))).toBe(true);
    expect(await ok('research_exports', F.researchExport(adminId, vid, { status: 'READY', file_reference: 'exports/x.xlsx', completed_at: new Date() }))).toBe(true);
    expect(await ok('research_exports', F.researchExport(adminId, vid, { status: 'READY', file_reference: null }))).toBe(false);
    expect(await ok('research_exports', F.researchExport(adminId, vid, { status: 'FAILED', file_reference: null, completed_at: new Date() }))).toBe(true);
    expect(await ok('research_exports', F.researchExport(adminId, vid, { status: 'FAILED', file_reference: 'exports/x.xlsx' }))).toBe(false);
  });
  test('B08-031 status enum and a required anonymisation version', async () => {
    expect(await ok('research_exports', F.researchExport(adminId, vid, { status: 'DONE' }))).toBe(false);
    expect(await ok('research_exports', F.researchExport(adminId, vid, { anonymisation_version: '' }))).toBe(false);
  });
});

describe('audit_logs', () => {
  test('B08-032 actor type enum and required fields', async () => {
    for (const t of ['ADMIN', 'SYSTEM', 'PARTICIPANT']) expect(await ok('audit_logs', F.audit({ actor_type: t }))).toBe(true);
    expect(await ok('audit_logs', F.audit({ actor_type: 'ROBOT' }))).toBe(false);
    expect(await ok('audit_logs', F.audit({ action_type: '' }))).toBe(false);
    const missing = F.audit();
    delete missing.target_entity;
    expect(await ok('audit_logs', missing)).toBe(false);
    expect(await ok('audit_logs', F.audit({ previous_state: { a: 1 }, new_state: { a: 2 } }))).toBe(true);
    expect(await ok('audit_logs', F.audit({ new_state: 'text' }))).toBe(false);
  });
});

describe('dev_identity_credentials', () => {
  test('G-01 dev credential shape', async () => {
    expect(await ok('dev_identity_credentials', F.devCredential())).toBe(true);
    expect(await ok('dev_identity_credentials', F.devCredential({ status: 'locked' }))).toBe(false);
    expect(await ok('dev_identity_credentials', F.devCredential({ secret_hash: '' }))).toBe(false);
    expect(await ok('dev_identity_credentials', { ...F.devCredential(), password: 'x' })).toBe(false);
  });
});
