/*
 * Attempt lifecycle (BUILD 05): create, begin/resume, pause, resume model, current answers. Delivery stops at SUBMITTED;
 * nothing here invokes quality or scoring, and no response contains a score.
 *
 * Authority: the participant id always comes from the verified token. Writes run as the controlled worker role with the
 * PARTICIPANT actor context, so the database procedures themselves refuse any other participant's attempt (SN011);
 * reads run under the participant's own RLS context and see only their own rows.
 */
const { HttpError } = require('../../../shared/errors');
const { withCanonicalTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const { message } = require('../shared/messages');
const controlPlane = require('./controlPlane');
const { selectVersion } = require('./versionSelector');

const MAX_SESSIONS = 4;
const OPEN_STATES = new Set(['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED']);

const participantTx = (participantId, fn, { write = false } = {}) => withCanonicalTx({ actorScope: 'PARTICIPANT', participantId, asWorker: write }, fn);
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Attempt not found');

/** Delivery state only: progress, session n of 4, last-saved time, whether Continue is available. Never a score. */
async function readResumeModel(tx, attemptId) {
  const a = (await tx.query(
    `SELECT a.attempt_id, a.status, a.session_count, a.last_activity_at, a.assessment_version_id
       FROM santulan.assessment_attempts a WHERE a.attempt_id = $1`, [attemptId])).rows[0];
  if (!a) throw notFound();
  const total = (await tx.query(
    `SELECT count(*)::int AS n FROM santulan.items WHERE assessment_version_id = $1 AND layer = 'CORE' AND status = 'ACTIVE'`, [a.assessmentVersionId])).rows[0].n;
  const completed = (await tx.query('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND is_current', [attemptId])).rows[0].n;
  const canContinue = OPEN_STATES.has(a.status) && !(a.status === 'PAUSED' && a.sessionCount >= MAX_SESSIONS);
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
  return withCanonicalTx({ actorScope: 'SYSTEM', asWorker: true }, async (tx) => {
    const p = (await tx.query(
      'SELECT participant_id, status, assessment_track, age_years_at_registration FROM santulan.participants WHERE participant_id = $1', [participantId])).rows[0];
    if (!p || p.status !== 'ACTIVE') throw new HttpError(403, 'FORBIDDEN', 'Participant is not active');
    const version = await selectVersion(tx, p);
    await controlPlane.assertOpen(tx, version);
    // the database enforces the consent gate, the age/track match, the FROZEN version and scale, and one nonterminal attempt
    const { rows } = await tx.query(
      `INSERT INTO santulan.assessment_attempts (participant_id, assessment_version_id, age_years_at_attempt) VALUES ($1, $2, $3) RETURNING attempt_id`,
      [participantId, version.assessmentVersionId, p.ageYearsAtRegistration],
    );
    await writeAudit(tx, { actorType: 'PARTICIPANT', actorId: participantId, actionType: 'ATTEMPT_CREATED', targetEntity: 'assessment_attempts', targetId: rows[0].attemptId, newState: { status: 'CREATED' }, correlationId });
    return readResumeModel(tx, rows[0].attemptId);
  });
}

async function loadVersionOf(tx, attemptId) {
  const v = (await tx.query(
    `SELECT v.status, v.participation_state FROM santulan.assessment_attempts a JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE a.attempt_id = $1`, [attemptId])).rows[0];
  if (!v) throw notFound();
  return v;
}

/** Begins session 1 or resumes; +1 only on a true session boundary (BUILD 05 §4). */
async function beginOrResume(participantId, attemptId) {
  return participantTx(participantId, async (tx) => {
    await controlPlane.assertOpen(tx, await loadVersionOf(tx, attemptId));
    await tx.query('SELECT santulan.begin_or_resume_session($1) AS n', [attemptId]);
    return readResumeModel(tx, attemptId);
  }, { write: true }).catch((err) => {
    if (err.code === 'SESSION_LIMIT') throw new HttpError(409, 'SESSION_LIMIT', message('sessionLimit'), { sessionsUsed: MAX_SESSIONS, canSubmit: true });
    throw err;
  });
}

/** Explicit pause / logout / server inactivity timeout: PAUSE + SESSION_END. */
async function pause(participantId, attemptId, reason = 'PARTICIPANT') {
  return participantTx(participantId, async (tx) => {
    await tx.query('SELECT santulan.pause_session($1, $2)', [attemptId, reason]);
    return readResumeModel(tx, attemptId);
  }, { write: true });
}

const getResumeModel = (participantId, attemptId) => participantTx(participantId, (tx) => readResumeModel(tx, attemptId));

/** Current answers only (never historical versions), in display order - enough to rebuild the player. */
async function getCurrentResponses(participantId, attemptId) {
  return participantTx(participantId, async (tx) => {
    await readResumeModel(tx, attemptId);                       // 404 unless the attempt is the participant's own
    const { rows } = await tx.query(
      `SELECT r.item_id, r.response_value, r.response_version, r.answered_at
         FROM santulan.responses r JOIN santulan.items i USING (item_id)
        WHERE r.attempt_id = $1 AND r.is_current ORDER BY i.display_order`, [attemptId]);
    return { attemptId, responses: rows.map((r) => ({ itemId: r.itemId, value: r.responseValue, version: r.responseVersion, savedAt: r.answeredAt })) };
  });
}

/**
 * What the player needs to render questions: the attempt's own version items (CORE, ACTIVE) in display order plus the frozen
 * scale anchors. Deliberately minimal - no keying, subdomain, hash or pilot status. Read under the participant's own RLS.
 */
async function getItems(participantId, attemptId) {
  return participantTx(participantId, async (tx) => {
    const a = (await tx.query('SELECT assessment_version_id FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rows[0];
    if (!a) throw notFound();
    const items = (await tx.query(
      `SELECT item_id, display_order, domain_code, item_text FROM santulan.items
        WHERE assessment_version_id = $1 AND layer = 'CORE' AND status = 'ACTIVE' ORDER BY display_order`, [a.assessmentVersionId])).rows;
    const scale = (await tx.query(
      `SELECT s.scale_points, s.anchor_labels FROM santulan.assessment_versions v JOIN santulan.response_scales s USING (response_scale_id)
        WHERE v.assessment_version_id = $1`, [a.assessmentVersionId])).rows[0];
    return {
      attemptId,
      scale: { points: scale.scalePoints, anchors: scale.anchorLabels },
      items: items.map((i) => ({ itemId: i.itemId, order: i.displayOrder, domainCode: i.domainCode, text: i.itemText })),
    };
  });
}

module.exports = { getItems, createAttempt, beginOrResume, pause, getResumeModel, getCurrentResponses, readResumeModel, participantTx, MAX_SESSIONS };
