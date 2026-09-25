/*
 * Report lifecycle rules (B07-001..007, 009, 014..016, 018, 019, 022, 076, 077, RC-09..RC-12): one report per attempt, complete only with
 * the PROFILE snapshot, atomic completion, controlled retry, immutable snapshots, PRIORITY / ACTION behind the developmentRelease switch.
 * Runs the report service against the SCRATCH database (no HTTP).
 */
const config = require('../../../src/config');
const store = require('../../../src/models/db');
const reportService = require('../../../src/services/reporting/reportService');
const rules = require('../../../src/services/domain/reportRules');
const p = require('../helpers/contractPipeline');
const { closeClient } = require('../../../src/models/db/client');

const { f, H, P, scoredAttempt, terminalAttempt, attemptStatus, clearRules } = p;
const failing = async () => { throw new Error('forced render failure'); };
const reportOf = async (id) => (await H.admin()).collection('reports').findOne({ attempt_id: id });
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);
const partial = async () => [
  { sectionType: 'PROFILE', domainCode: null, contentVersion: 'profile-v1', locale: 'en', displayOrder: 1, contentSnapshot: '{}', released: true },
  { sectionType: 'MEANING', domainCode: 'C1', contentVersion: null, locale: 'en', displayOrder: 2, contentSnapshot: 'x', released: true }, // the store validator refuses this one
];

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { config.reportVersion = REPORT_VERSION; await clearRules(); await p.resetSwitches(); });
const REPORT_VERSION = config.reportVersion;
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('the state machine (RC-09..RC-12)', () => {
  test('the transition table: PENDING -> READY | FAILED_RETRYABLE | UNDER_REVIEW | NOT_ELIGIBLE; FAILED_RETRYABLE -> PENDING only; the rest are terminal', () => {
    expect(rules.canMove('PENDING', 'REPORT_READY')).toBe(true);
    expect(rules.canMove('PENDING', 'FAILED_RETRYABLE')).toBe(true);
    expect(rules.canMove('FAILED_RETRYABLE', 'PENDING')).toBe(true);
    expect(rules.canMove('FAILED_RETRYABLE', 'REPORT_READY')).toBe(false);
    for (const terminal of ['REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE']) for (const to of ['PENDING', 'REPORT_READY', 'FAILED_RETRYABLE']) expect(rules.canMove(terminal, to)).toBe(false);
    expect([...rules.PARTICIPANT_VISIBLE].sort()).toEqual(['NOT_ELIGIBLE', 'REPORT_READY', 'UNDER_REVIEW']);
  });

  test('B07-001 one report per attempt: concurrent begins converge on one shell, and a second report_version is refused', async () => {
    const a = await scoredAttempt({ s2: true });
    const runs = await Promise.all([1, 2, 3, 4].map(() => reportService.generateReport(a.id)));
    expect(new Set(runs.map((r) => r.reportId)).size).toBe(1);
    expect(runs.every((r) => r.state === 'REPORT_READY')).toBe(true);
    expect(await count('reports', { attempt_id: a.id })).toBe(1);
    expect(await count('report_sections', { report_id: runs[0].reportId, section_type: 'PROFILE' })).toBe(1);
    config.reportVersion = 'report-other-version';
    await expect(reportService.generateReport(a.id)).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });
    expect(await count('reports', { attempt_id: a.id })).toBe(1);
  });

  test('B07-002/003 a report is PENDING and invisible until complete; completion sets the report and the attempt to REPORT_READY together with a 64-hex content_hash', async () => {
    const a = await scoredAttempt({ s2: true });
    let seenDuringRender = null;
    let gate = null;
    const spy = async (tx, attemptId) => {
      seenDuringRender = await store.withScope(store.participantScope(a.p.participantId), async (ptx) => (await ptx.c.reports.find({ attempt_id: attemptId }))[0] || null);
      gate = await reportService.getParticipantReport(a.p.participantId, seenDuringRender._id).catch((e) => e);
      return require('../../../src/services/reporting/reportRenderer').renderAttempt(tx, attemptId);
    };
    const done = await reportService.generateReport(a.id, { renderer: spy });
    expect(done.state).toBe('REPORT_READY');
    expect(seenDuringRender).toMatchObject({ generation_status: 'PENDING' });
    expect(gate).toMatchObject({ status: 404, code: 'REPORT_NOT_READY' }); // PENDING is never shown to the participant
    const row = await reportOf(a.id);
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.generated_at).toBeInstanceOf(Date);
    expect(await attemptStatus(a.id)).toBe('REPORT_READY');
    await expect(reportService.getParticipantReport(a.p.participantId, done.reportId)).resolves.toMatchObject({ state: 'REPORT_READY' });
  });

  test('B07-004/005/076 a render failure leaves nothing behind (no section, no hash), records FAILED_RETRYABLE in a second transaction and the attempt stays SCORED', async () => {
    const a = await scoredAttempt({ s2: true });
    for (const renderer of [failing, partial]) {
      const attempt = await scoredAttempt({ s2: true });
      const out = await reportService.generateReport(attempt.id, { renderer });
      expect(out).toMatchObject({ state: 'FAILED_RETRYABLE', retryCount: 0 });
      const row = await reportOf(attempt.id);
      expect(row).toMatchObject({ generation_status: 'FAILED_RETRYABLE', content_hash: null, generated_at: null });
      expect(row.last_error_code).toMatch(/^[A-Z0-9_]{2,32}$/);
      expect(await count('report_sections', { report_id: row._id })).toBe(0); // the partially valid batch was rolled back as a whole
      expect(await attemptStatus(attempt.id)).toBe('SCORED');
      await expect(reportService.getParticipantReport(attempt.p.participantId, row._id)).rejects.toMatchObject({ status: 404, code: 'REPORT_NOT_READY' });
    }
    expect(await count('reports', { attempt_id: a.id })).toBe(0);
  });

  test('B07-006/007 a report is complete only after its PROFILE exists: a renderer without one fails the report instead of completing it', async () => {
    const a = await scoredAttempt({ s2: true });
    const out = await reportService.generateReport(a.id, { renderer: async () => [{ sectionType: 'MEANING', domainCode: 'C1', contentVersion: 'v', locale: 'en', displayOrder: 1, contentSnapshot: 'x', released: true }] });
    expect(out.state).toBe('FAILED_RETRYABLE');
    expect(await attemptStatus(a.id)).toBe('SCORED');
    expect(await count('report_sections', { report_id: out.reportId })).toBe(0);
  });

  test('B07-014/015/077 retry is FAILED_RETRYABLE -> PENDING with retry_count + 1, a REPORT_RETRY event and an audit row; two simultaneous retries make ONE transition', async () => {
    const a = await scoredAttempt({ s2: true });
    const failed = await reportService.generateReport(a.id, { renderer: failing });
    const results = await Promise.allSettled([reportService.retryReport(failed.reportId), reportService.retryReport(failed.reportId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409)).toBe(true);
    const row = await reportOf(a.id);
    expect(row).toMatchObject({ generation_status: 'REPORT_READY', retry_count: 1 });
    expect(await count('response_events', { attempt_id: a.id, event_type: 'REPORT_RETRY' })).toBe(1);
    expect(await count('audit_logs', { target_id: row._id, action_type: 'REPORT_RETRIED' })).toBe(1);
    await expect(reportService.retryReport(failed.reportId)).rejects.toMatchObject({ status: 409 }); // no longer failed
    await expect(reportService.retryReport('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  test('retry never rescores and never retakes: scores, answers and the attempt count are untouched', async () => {
    const a = await scoredAttempt({ s2: true });
    const before = { scores: (await P.scoresOf(a.id)).map((s) => `${s._id}:${s.raw_score}`), responses: await count('responses', { attempt_id: a.id }), attempts: await count('assessment_attempts', { participant_id: a.p.participantId }) };
    const failed = await reportService.generateReport(a.id, { renderer: failing });
    await reportService.retryReport(failed.reportId);
    expect({ scores: (await P.scoresOf(a.id)).map((s) => `${s._id}:${s.raw_score}`), responses: await count('responses', { attempt_id: a.id }), attempts: await count('assessment_attempts', { participant_id: a.p.participantId }) }).toEqual(before);
  });
});

describe('sections are snapshots (B07-016, 018, 019, 022)', () => {
  test('sections are written only while PENDING: completing twice adds nothing', async () => {
    const a = await scoredAttempt({ s2: true });
    const done = await reportService.generateReport(a.id);
    const sections = await count('report_sections', { report_id: done.reportId });
    const again = await store.withScope(store.systemScope(), (tx) => require('../../../src/models/repositories/reports').getReport(tx, done.reportId));
    expect(again.generationStatus).toBe('REPORT_READY');
    await reportService.generateReport(a.id);
    expect(await count('report_sections', { report_id: done.reportId })).toBe(sections);
  });

  test('snapshot fields never change: only is_released_to_participant is updatable, even by the system credential', async () => {
    const a = await scoredAttempt({ s2: true });
    const done = await reportService.generateReport(a.id);
    const [section] = await P.sectionsOf(done.reportId);
    await store.withScope(store.systemScope(), async (tx) => {
      for (const field of ['content_snapshot', 'content_version', 'section_type', 'display_order', 'domain_code', 'locale']) {
        await expect(tx.c.report_sections.updateOne({ _id: section._id }, { $set: { [field]: 'changed' } })).rejects.toMatchObject({ status: 403 });
      }
      await expect(tx.c.reports.updateOne({ _id: done.reportId }, { $set: { report_version: 'other' } })).rejects.toMatchObject({ status: 403 });
    });
    expect((await P.sectionsOf(done.reportId))[0].content_snapshot).toBe(section.content_snapshot);
  });

  test('a later attempt never changes an earlier report: regenerating from the same frozen inputs gives the same fingerprint', async () => {
    const a = await scoredAttempt({ s2: true });
    const done = await reportService.generateReport(a.id);
    const hash = (await reportOf(a.id)).content_hash;
    const later = await scoredAttempt({ s2: true });
    await reportService.generateReport(later.id);
    const rendered = await store.withScope(store.systemScope(), (tx) => require('../../../src/services/reporting/reportRenderer').renderAttempt(tx, a.id));
    expect(rules.fingerprint(rendered)).toBe(hash);
    expect(done.reportId).toBeTruthy();
  });

  test('PRIORITY / ACTION are released only with the developmentRelease switch (isReleasable), never by a participant', async () => {
    expect(rules.isReleasable('PRIORITY', { developmentRelease: false })).toBe(false);
    expect(rules.isReleasable('ACTION', {})).toBe(false);
    expect(rules.isReleasable('PRIORITY', { developmentRelease: true })).toBe(true);
    expect(rules.isReleasable('ACTION', { developmentRelease: true })).toBe(true);
    for (const layer of ['PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'UNDER_REVIEW', 'NOT_ELIGIBLE']) expect(rules.isReleasable(layer, {})).toBe(true);
    expect(rules.isReleasable('SOMETHING_ELSE', { developmentRelease: true })).toBe(false); // unknown layers fail closed
  });
});

describe('T11 / T12 (B07-009..013)', () => {
  test('a held attempt yields UNDER_REVIEW and an invalid one NOT_ELIGIBLE: one fixed neutral section each, identical for every reason (Q09 included), attempts unchanged', async () => {
    const holds = [await terminalAttempt('QUALITY_HOLD'), await terminalAttempt('QUALITY_HOLD', { q09: true })];
    const invalids = [await terminalAttempt('INVALID'), await terminalAttempt('INVALID', { q09: true })];
    for (const [group, state] of [[holds, 'UNDER_REVIEW'], [invalids, 'NOT_ELIGIBLE']]) {
      const outs = [];
      for (const a of group) {
        const out = await reportService.generateReport(a.id);
        expect(out.state).toBe(state);
        const sections = await P.sectionsOf(out.reportId);
        expect(sections).toHaveLength(1);
        outs.push(sections[0].content_snapshot);
        expect((await reportOf(a.id)).content_hash).toBe(rules.fingerprint(sections));
        expect(await attemptStatus(a.id)).toBe(state === 'UNDER_REVIEW' ? 'QUALITY_HOLD' : 'INVALID');
      }
      expect(new Set(outs).size).toBe(1);
    }
  });

  test('a report starts only from a scored, held or invalid attempt', async () => {
    const a = await P.submittedAttempt(p.currentSet());
    await expect(reportService.generateReport(a.attemptId)).rejects.toMatchObject({ status: 422, code: 'INVALID_STATE' });
    await expect(reportService.generateReport('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});
