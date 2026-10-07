/*
 * Claims governance on the document store (T152; SEC-25, FR-035, SC-020): the claims scanner is a pure module with positive tests
 * for every rule, and an authentic score -> report -> export journey on the scratch database carries none of the prohibited
 * claims anywhere the participant can see: report snapshots, the report API JSON, and the text cells of a generated export workbook.
 */
process.env.EXPORT_DIR = require('path').join(require('os').tmpdir(), `santulan-claims-export-${process.pid}`);

const fs = require('fs');
const request = require('supertest');
const XLSX = require('xlsx');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { scanClaims, assertNoClaims, RULES } = require('../helpers/claimsScanner');
const store = require('../../../src/models/db');
const { claimAndGenerate, getStatus } = require('../../../src/services/research/exportService');

const EXPORT_DIR = process.env.EXPORT_DIR;
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const auth = (who) => ({ Authorization: `Bearer ${who.token}` });
const post = (p, who, body) => api().post(`/api/v1${p}`).set(auth(who)).send(body);
const get = (p, who) => api().get(`/api/v1${p}`).set(auth(who));
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);
const u = () => f.u();

let S;
let admin;
let reportId;
let attemptId;
let ownerP;

const fixtureForRule = (rule) => ({
  DIAGNOSIS_OR_CLINICAL: 'This result may indicate a medical disorder to discuss.',
  INTELLIGENCE_INFERENCE: 'Your cognitive ability is a strong asset.',
  BAND_LABEL: 'Your average level puts you in the normal range.',
  PERCENTILE_OR_NORM: 'You scored above the 90th percentile.',
  RELIABLE_CHANGE_OR_IMPROVEMENT: 'Your score reliably improved compared with last time.',
  SUBDOMAIN_SCORE: 'Your C2.4 result is available.',
  PERSONALITY_TYPING: 'You appear introverted in group settings.',
  ATTENTION_OR_INTELLIGENCE_FROM_C7: 'This could reflect an attention-deficit pattern.',
  TOUGHNESS_OR_SILENT_ENDURANCE: 'You show remarkable mental toughness in setbacks.',
})[rule];

const BENIGN = 'You completed the survey. Thank you for taking part.';

beforeAll(async () => {
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  admin = await f.admin();
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const p = await f.participant(15);
  ownerP = p;
  const created = await post('/attempts', p);
  attemptId = created.body.attemptId;
  await post(`/attempts/${attemptId}/sessions/resume`, p);
  await f.answerAll(attemptId, () => '3');
  await post(`/attempts/${attemptId}/submit`, p, { submissionKey: `sub-${u()}-${u()}` });
  await internal('post', `/internal/attempts/${attemptId}/quality`, {});
  await internal('post', `/internal/attempts/${attemptId}/score`, { scoringVersion: 'domain-mean-v1' });
  const report = await internal('post', `/internal/attempts/${attemptId}/report`, {});
  expect(report.body.state).toBe('REPORT_READY');
  reportId = report.body.reportId;
});

afterAll(async () => {
  await f.closeOpenSets();
  await f.cleanupFixtures();
  await (await H.admin()).collection('reports').deleteMany({ _id: reportId });
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  await store.closeClient();
  await H.closeAll();
});

describe('the claims scanner is a pure module with positive tests for every rule (FR-035)', () => {
  test('FR-035 the scanner is storage-independent and has a stable, documented rule set', () => {
    const expected = ['DIAGNOSIS_OR_CLINICAL', 'INTELLIGENCE_INFERENCE', 'BAND_LABEL', 'PERCENTILE_OR_NORM', 'RELIABLE_CHANGE_OR_IMPROVEMENT',
      'SUBDOMAIN_SCORE', 'PERSONALITY_TYPING', 'ATTENTION_OR_INTELLIGENCE_FROM_C7', 'TOUGHNESS_OR_SILENT_ENDURANCE'];
    expect(Object.keys(RULES).sort()).toEqual(expected.slice().sort());
    for (const fn of [scanClaims, assertNoClaims]) expect(typeof fn).toBe('function');
    expect(() => assertNoClaims(BENIGN)).not.toThrow();
  });

  test.each(Object.keys(RULES))('FR-035 rule %s has a positive control it catches', (rule) => {
    const hits = scanClaims(fixtureForRule(rule));
    expect(hits.some((h) => h.rule === rule)).toBe(true);
  });

  test('FR-035 the scanner catches a claim in object keys and in arrays, not just plain strings', () => {
    expect(scanClaims({ percentile: 99, note: BENIGN })).toEqual([{ rule: 'PERCENTILE_OR_NORM', match: 'percentile' }]);
    expect(scanClaims([BENIGN, 'reliably improved'])).toEqual([{ rule: 'RELIABLE_CHANGE_OR_IMPROVEMENT', match: 'reliably improved' }]);
    expect(scanClaims(null)).toEqual([]);
  });
});

describe('authentic pipeline output on the scratch database (SEC-25, SC-020)', () => {
  test('SEC-25 an authentic scored report (snapshot content and API JSON) carries no prohibited claim', async () => {
    // G-04: the student sees nothing until an admin releases the report; release it (as the admin endpoint does) before reading it
    const reviewer = await f.admin();
    await require('../../../src/services/reporting/reportService').releaseReport(reportId, { actorId: reviewer.adminUserId, correlationId: null });
    const shown = await get(`/reports/${reportId}`, ownerP);
    expect(shown.status).toBe(200);
    expect(shown.body.sections.map((s) => s.type)).toEqual(['PROFILE']);
    expect(scanClaims(shown.body)).toEqual([]);
    const snapshots = await (await H.admin()).collection('report_sections').find({ report_id: reportId }).toArray();
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) {
      expect(scanClaims(JSON.parse(s.content_snapshot))).toEqual([]);
      expect(scanClaims(s.content_snapshot)).toEqual([]);
    }
  });

  test('SC-020 the text cells of a generated export workbook carry no prohibited claim', async () => {
    const key = `T152-export-${u()}-${u()}`;
    const claim = await api().post('/api/v1/research-exports')
      .set(auth(admin)).set('Idempotency-Key', key)
      .send({ sourceAssessmentVersionId: S.setId, anonymisationVersion: 'fx-anon-v1' });
    expect(claim.status).toBe(202);
    const done = await claimAndGenerate(claim.body.exportId);
    expect(done.status).toBe('READY');
    const statusRow = await getStatus(admin, claim.body.exportId);
    expect(statusRow.status).toBe('READY');
    const res = await api().get(`/api/v1/research-exports/${claim.body.exportId}/download`)
      .set(auth(admin)).buffer(true).parse((r, cb) => { const cs = []; r.on('data', (c) => cs.push(c)); r.on('end', () => cb(null, Buffer.concat(cs))); });
    expect(res.status).toBe(200);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    // ITEM_CODEBOOK and ITEM_RESPONSES_LONG_nn carry subdomain_code (e.g. "C1.1") as a structural instrument-metadata
    // column - this is the approved sample format (docs/Santulan 2.0/Profile), not a participant-facing claim about any
    // one score, so SUBDOMAIN_SCORE is scoped out of those two sheets only; every other rule still applies everywhere.
    const structuralSubdomainSheets = /^(ITEM_CODEBOOK|ITEM_RESPONSES_LONG_\d+)$/;
    for (const name of wb.SheetNames) {
      const cells = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false })
        .flat().filter((c) => c !== null && c !== undefined).map(String).join(' ');
      const hits = scanClaims({ sheet: name, cells });
      const relevant = structuralSubdomainSheets.test(name) ? hits.filter((h) => h.rule !== 'SUBDOMAIN_SCORE') : hits;
      expect(relevant).toEqual([]);
    }
    await (await H.admin()).collection('research_exports').deleteMany({ _id: claim.body.exportId });
  });

  test('SC-020 a report that would carry a claim is caught by the scanner (negative control)', async () => {
    const hits = scanClaims({ sections: [{ type: 'PROFILE', content: `Your ${fixtureForRule('DIAGNOSIS_OR_CLINICAL')} ${fixtureForRule('INTELLIGENCE_INFERENCE')}` }] });
    expect(hits.map((h) => h.rule)).toEqual(expect.arrayContaining(['DIAGNOSIS_OR_CLINICAL', 'INTELLIGENCE_INFERENCE']));
    expect(() => assertNoClaims({ sections: [{ content: BENIGN }] })).not.toThrow();
  });
});