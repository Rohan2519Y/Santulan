/*
 * Attempt lifecycle (BUILD 05), on the store: create, begin/resume, pause, resume model, current answers, question list.
 * Delivery stops at SUBMITTED; nothing here invokes quality or scoring, and no response contains a score.
 *
 * Authority: the participant id always comes from the verified token. Writes run under the PARTICIPANT scope, so the access
 * layer itself refuses any other participant's attempt; the create step runs under SYSTEM (it reads the open set and the
 * control plane) and re-checks everything for that participant.
 */
const { HttpError } = require('../../../shared/errors');
const store = require('../store');
const identity = require('../store/repositories/identity');
const delivery = require('../store/repositories/delivery');
const responsesRepo = require('../store/repositories/responses');
const { writeAudit } = require('../audit/auditService');
const { message } = require('../shared/messages');
const attemptRules = require('../domain/attemptRules');
const consentRules = require('../domain/consentRules');
const consents = require('../store/repositories/consents');
const controlPlane = require('../domain/controlPlane');
const reportRules = require('../domain/reportRules');
const reportsRepo = require('../store/repositories/reports');
const { selectSet } = require('./versionSelector');
const { assertIntact } = require('../questionsets/verifyFrozenSets');

const { MAX_SESSIONS } = attemptRules;
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Attempt not found');

/** Runs `fn(tx)` under the participant's own scope (in a transaction when it writes). */
const participantTx = (participantId, fn, { write = false } = {}) => store.withScope(store.participantScope(participantId), fn, { transaction: write });

/** Delivery state only: progress, session n of 4, last-saved time, whether Continue is available. Never a score. */
async function readResumeModel(tx, attemptId) {
  const a = await delivery.getAttempt(tx, attemptId);
  if (!a) throw notFound();
  const total = await tx.c.items.count({ assessment_version_id: a.assessmentVersionId, layer: 'CORE', status: 'ACTIVE' });
  const completed = await responsesRepo.countCurrent(tx, attemptId);
  const canContinue = attemptRules.OPEN_STATES.has(a.status) && !(a.status === 'PAUSED' && a.sessionCount >= MAX_SESSIONS);
  return {
    attemptId: a.attemptId,
    status: a.status,
    progress: { completed, total, percent: total ? Math.round((completed * 100) / total) : 0 },
    session: { n: a.sessionCount, of: MAX_SESSIONS },
    lastSavedAt: a.lastActivityAt,
    canContinue,
  };
}

async function createAttempt(participantId, correlationId) {
  return store.withScope(store.systemScope(), async (tx) => {
    const p = await identity.getParticipant(tx, participantId);
    if (!p || p.status !== 'ACTIVE') throw new HttpError(403, 'FORBIDDEN', 'Participant is not active');
    const set = await selectSet(tx, p);
    await controlPlane.assertOpen(tx, set);
    await assertIntact(tx, set); // a frozen set whose questions no longer match its fingerprint is never served
    const gate = consentRules.evaluateGate(p, await consents.listForParticipant(tx, participantId));
    await attemptRules.assertCanStart(tx, { participant: p, set, gate });
    const existing = await delivery.latestAttemptOf(tx, participantId);
    if (existing && attemptRules.NONTERMINAL.includes(existing.status)) throw new HttpError(409, 'INVALID_STATE', 'An assessment attempt is already in progress'); // B05-001 (the store index is the race guard)
    const attempt = await delivery.insertAttempt(tx, { participantId, assessmentVersionId: set._id, ageYears: p.ageYearsAtRegistration });
    await writeAudit(tx, { actorType: 'PARTICIPANT', actorId: participantId, actionType: 'ATTEMPT_CREATED', targetEntity: 'assessment_attempts', targetId: attempt.attemptId, newState: { status: 'CREATED' }, correlationId });
    return readResumeModel(tx, attempt.attemptId);
  }, { transaction: true });
}

async function loadSetOf(tx, attempt) {
  return tx.c.assessment_versions.findOne({ _id: attempt.assessmentVersionId });
}

/** Begins session 1 or resumes; +1 only on a true session boundary (BUILD 05 section 4). */
async function beginOrResume(participantId, attemptId) {
  try {
    return await participantTx(participantId, async (tx) => {
      const a = await delivery.getAttempt(tx, attemptId);
      if (!a) throw notFound();
      // the control plane is a privileged read; run it under the system scope of this same store connection
      await store.withScope(store.systemScope(), async (sys) => controlPlane.assertOpen(sys, await loadSetOf(sys, a)));
      const plan = attemptRules.planBeginOrResume(a);
      if (!(await delivery.moveAttempt(tx, attemptId, plan.from, plan.patch))) throw attemptRules.invalidState('The attempt changed while starting the session; try again');
      await delivery.appendEvent(tx, { ...a, sessionCount: plan.sessionCount }, plan.event);
      return readResumeModel(tx, attemptId);
    }, { write: true });
  } catch (err) {
    if (err.code === 'SESSION_LIMIT') throw new HttpError(409, 'SESSION_LIMIT', message('sessionLimit'), { sessionsUsed: MAX_SESSIONS, canSubmit: true });
    throw err;
  }
}

/** Explicit pause / logout / server inactivity timeout: PAUSE + SESSION_END. */
async function pause(participantId, attemptId, reason = 'PARTICIPANT') {
  return participantTx(participantId, async (tx) => {
    const a = await delivery.getAttempt(tx, attemptId);
    if (!a) throw notFound();
    const plan = attemptRules.planPause(a, reason);
    if (!(await delivery.moveAttempt(tx, attemptId, plan.from, plan.patch))) throw attemptRules.invalidState('The attempt changed while pausing; try again');
    for (const e of plan.events) await delivery.appendEvent(tx, a, e);
    return readResumeModel(tx, attemptId);
  }, { write: true });
}

/**
 * The model returned by GET /attempts/{id}. `reportId` (ASSUMED, D-M18) is the id of the participant's own report once it is visible to
 * them (REPORT_READY, UNDER_REVIEW, NOT_ELIGIBLE), otherwise null: with the score endpoint withdrawn the results page has no other way
 * to find GET /reports/{id}. It is an id only - no state detail, no content.
 */
const getResumeModel = (participantId, attemptId) => participantTx(participantId, async (tx) => {
  const model = await readResumeModel(tx, attemptId);
  const report = await reportsRepo.getByAttempt(tx, attemptId);
  return { ...model, reportId: report && reportRules.PARTICIPANT_VISIBLE.has(report.generationStatus) ? report.reportId : null };
});

/** Current answers only (never historical versions), in display order - enough to rebuild the player. */
async function getCurrentResponses(participantId, attemptId) {
  return participantTx(participantId, async (tx) => {
    const a = await delivery.getAttempt(tx, attemptId); // 404 unless the attempt is the participant's own
    if (!a) throw notFound();
    const items = await tx.c.items.find({ assessment_version_id: a.assessmentVersionId }, { projection: { display_order: 1 } });
    const order = new Map(items.map((i) => [i._id, i.display_order]));
    const rows = (await responsesRepo.currentByAttempt(tx, attemptId)).sort((x, y) => (order.get(x.item_id) || 0) - (order.get(y.item_id) || 0));
    return { attemptId, responses: rows.map((r) => ({ itemId: r.item_id, value: r.response_value, version: r.response_version, savedAt: r.answered_at })) };
  });
}

/**
 * What the player needs to render questions: the attempt's own set's CORE ACTIVE questions in display order, each with its OWN
 * options in the uploaded order. Deliberately minimal - no keying, subdomain, hash or pilot status.
 */
async function getItems(participantId, attemptId) {
  return participantTx(participantId, async (tx) => {
    const a = await delivery.getAttempt(tx, attemptId);
    if (!a) throw notFound();
    const items = await tx.c.items.find({ assessment_version_id: a.assessmentVersionId, layer: 'CORE', status: 'ACTIVE' }, { sort: { display_order: 1 } });
    return {
      attemptId,
      items: items.map((i) => ({ itemId: i._id, order: i.display_order, domainCode: i.domain_code, text: i.item_text, options: i.options.map((o) => ({ position: o.position, text: o.text })) })),
    };
  });
}

module.exports = { getItems, createAttempt, beginOrResume, pause, getResumeModel, getCurrentResponses, readResumeModel, participantTx, MAX_SESSIONS };
