/*
 * T172 (journey half): the single continuous run of spec US1 acceptance 1-6 on the MongoDB store, entirely over the real
 * HTTP app (register -> consent -> open a set -> answer -> submit -> score -> report -> admin export), on the scratch
 * database with the runtime credential doing the actual work. This is the one place the whole chain runs end to end in a
 * single test rather than being split across the per-feature suites; those suites remain the primary coverage for each
 * step's edge cases (upload validation, concurrency, isolation, abuse throttling, and so on).
 *
 * Consent is exercised through the new CR-006-13 self-consent endpoint (an adult participant), which doubles as a real
 * end-to-end confirmation of that feature. The question set is deleted with CR-006-12 afterwards to confirm a draft
 * left behind by an earlier step of this same run can be cleaned up too.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/models/db/client');
const { claimAndGenerate } = require('../../../src/services/research/exportService');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const asAdmin = (adm) => ({ Authorization: `Bearer ${adm.token}` });
const asParticipant = (p) => ({ Authorization: `Bearer ${p.token}` });

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('T172: the whole US1 journey once, over HTTP, on MongoDB (acceptance 1-6)', () => {
  test('register -> self-consent -> upload/freeze/open -> answer -> submit -> score -> report -> admin export', async () => {
    // 1) An adult participant, registered with no consent yet (fixture identity, as every HTTP suite in this repo uses -
    // OTP delivery itself is not testable without a live provider; everything from here on is a real HTTP call).
    const participant = await f.participant(20, { consents: false });

    // 2) CR-006-13: the participant confirms their own consent with the one-checkbox self-consent endpoint.
    const consentRes = await api().post('/api/v1/consents/self-consent').set(asParticipant(participant)).send({});
    expect(consentRes.status).toBe(201);
    expect(consentRes.body).toMatchObject({ status: 'VERIFIED', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' });

    // 3) The admin uploads, freezes and opens a fresh emerging-adult set (US2, US4).
    const label = `fx-e2e-${f.u().toLowerCase()}`;
    const rows = W.validRows({ label, ageGroup: 'EMERGING_ADULT' });
    const upload = await api().post('/api/v1/admin/question-sets').set(asAdmin(admin)).field('ageGroup', 'EMERGING_ADULT').attach('file', W.workbook(rows), 'q.xlsx');
    expect(upload.status).toBe(201);
    const setId = upload.body.setId;
    const frozen = await api().post(`/api/v1/admin/question-sets/${setId}/freeze`).set(asAdmin(admin)).send({});
    expect(frozen.status).toBe(200);
    const opened = await api().post(`/api/v1/admin/question-sets/${setId}/open`).set(asAdmin(admin)).send({ reason: 'T172 end-to-end journey run' });
    expect(opened.status).toBe(200);

    // 4) The participant starts an attempt; the server chooses the single open set of their age group (no version accepted).
    const attemptRes = await api().post('/api/v1/attempts').set(asParticipant(participant)).send({});
    expect(attemptRes.status).toBe(201);
    const attemptId = attemptRes.body.attemptId;
    const resume = await api().post(`/api/v1/attempts/${attemptId}/sessions/resume`).set(asParticipant(participant)).send({});
    expect(resume.status).toBe(200);

    // 5) Every item lists exactly its own options; answer each one at its first position.
    const itemsRes = await api().get(`/api/v1/attempts/${attemptId}/items`).set(asParticipant(participant));
    expect(itemsRes.status).toBe(200);
    expect(itemsRes.body.items.length).toBeGreaterThanOrEqual(7); // one per domain, at least
    for (const item of itemsRes.body.items) {
      const save = await api().post(`/api/v1/attempts/${attemptId}/responses`).set(asParticipant(participant))
        .send({ itemId: item.itemId, value: String(item.options[0].position), idempotencyKey: `e2e-${attemptId}-${item.itemId}` });
      expect(save.status).toBe(200);
    }

    // Acceptance 3 (immutability): the store itself refuses to change a saved answer via update/delete; there is no
    // endpoint that edits or removes a response at all - re-saving the same item creates a new version, never an edit.
    const firstItem = itemsRes.body.items[0];
    const resave = await api().post(`/api/v1/attempts/${attemptId}/responses`).set(asParticipant(participant))
      .send({ itemId: firstItem.itemId, value: String(firstItem.options[0].position), idempotencyKey: `e2e-resave-${attemptId}-${firstItem.itemId}` });
    expect(resave.status).toBe(200); // a new current version, the old one kept as history (store/validators.content.test.js covers the invariant directly)

    // 6) Submit closes delivery.
    const submit = await api().post(`/api/v1/attempts/${attemptId}/submit`).set(asParticipant(participant)).send({ submissionKey: `e2e-submit-${attemptId}` });
    expect(submit.status).toBe(200);

    // Acceptance 4 (isolation): a second participant cannot read this attempt, its items or the eventual report.
    const other = await f.participant(20, { consents: true });
    expect((await api().get(`/api/v1/attempts/${attemptId}`).set(asParticipant(other))).status).toBe(404);
    expect((await api().get(`/api/v1/attempts/${attemptId}/responses`).set(asParticipant(other))).status).toBe(404);

    // 7) Quality then scoring, through the internal endpoints (as the pipeline worker would call them).
    const quality = await api().post(`/api/v1/internal/attempts/${attemptId}/quality`).set(INTERNAL).send({});
    expect(quality.status).toBe(200);
    expect(quality.body.outcome).toBe('CLEAR');
    const score = await api().post(`/api/v1/internal/attempts/${attemptId}/score`).set(INTERNAL).send({ scoringVersion: 'domain-mean-v1' });
    expect(score.status).toBe(200);

    // 8) Report generation (switches off -> S1 everywhere -> PROFILE-only report, "Not enough data yet"; this still
    // proves the full pipeline runs and the participant can read their own report, without needing approved wording).
    const gen = await api().post(`/api/v1/internal/attempts/${attemptId}/report`).set(INTERNAL).send({});
    expect(gen.status).toBe(200);
    const attemptAfter = await api().get(`/api/v1/attempts/${attemptId}`).set(asParticipant(participant));
    expect(attemptAfter.status).toBe(200);
    expect(attemptAfter.body.reportId).toBeTruthy();
    const reportId = attemptAfter.body.reportId;
    const reportRes = await api().get(`/api/v1/reports/${reportId}`).set(asParticipant(participant));
    expect(reportRes.status).toBe(200);
    const profile = reportRes.body.sections.find((s) => s.type === 'PROFILE');
    expect(profile).toBeTruthy();
    expect(JSON.parse(profile.content).domains).toHaveLength(7);

    // Isolation again, this time on the report itself.
    expect((await api().get(`/api/v1/reports/${reportId}`).set(asParticipant(other))).status).toBe(404);

    // 9) Admin research export: request, drive the worker once (as the real background worker would), then download.
    const exportReq = await api().post('/api/v1/research-exports').set(asAdmin(admin))
      .set('Idempotency-Key', `e2e-export-${setId}`).send({ sourceAssessmentVersionId: setId, anonymisationVersion: 'e2e-v1' });
    expect(exportReq.status).toBe(202);
    const exportDone = await claimAndGenerate(exportReq.body.exportId);
    expect(exportDone.status).toBe('READY');
    const download = await api().get(`/api/v1/research-exports/${exportReq.body.exportId}/download`).set(asAdmin(admin))
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(download.status).toBe(200);
    expect(download.body.length).toBeGreaterThan(0);

    // CR-006-12: the draft habit left behind by an earlier phase of this same run (a would-be re-upload, never frozen)
    // can be deleted; the frozen set actually used above cannot (constitution IV - proven directly in
    // questionSetsLifecycle.test.js's CR-006-12 block, not repeated here).
    const strayLabel = `fx-e2e-stray-${f.u().toLowerCase()}`;
    const strayUpload = await api().post('/api/v1/admin/question-sets').set(asAdmin(admin)).field('ageGroup', 'EMERGING_ADULT').attach('file', W.workbook(W.validRows({ label: strayLabel, ageGroup: 'EMERGING_ADULT' })), 'q.xlsx');
    expect(strayUpload.status).toBe(201);
    const strayDelete = await api().post(`/api/v1/admin/question-sets/${strayUpload.body.setId}/delete`).set(asAdmin(admin)).send({});
    expect(strayDelete.status).toBe(200);
    expect(strayDelete.body.status).toBe('RETIRED');
  }, 60000);
});
