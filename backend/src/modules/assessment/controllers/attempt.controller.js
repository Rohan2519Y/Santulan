const db = require('../../../shared/db');
const profileService = require('../services/profile.service');
const attemptService = require('../services/attempt.service');
const submitService = require('../services/submit.service');

async function startOrResume(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.createOrResumeAttempt(profile);
    const view = await attemptService.buildAttemptView(attempt, profile);
    res.status(201).json({ attempt: view });
  } catch (err) {
    next(err);
  }
}

async function pause(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.findOwnedAttempt(req.params.attemptId, profile.id);
    const updated = await attemptService.pauseAttempt(attempt);
    res.json({ attempt: { id: updated.id, status: updated.status, sessionCount: updated.sessionCount } });
  } catch (err) {
    next(err);
  }
}

async function resume(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.findOwnedAttempt(req.params.attemptId, profile.id);
    const updated = await attemptService.resumeAttempt(attempt);
    const view = await attemptService.buildAttemptView(updated, profile);
    res.json({ attempt: view });
  } catch (err) {
    next(err);
  }
}

async function submit(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.findOwnedAttempt(req.params.attemptId, profile.id);
    const result = await submitService.submitAttempt(attempt, profile);
    res.json({
      attempt: { id: result.attempt.id, status: result.attempt.status },
      report: result.report
        ? { id: result.report.id, generationStatus: result.report.generationStatus, released: true }
        : null,
    });
  } catch (err) {
    next(err);
  }
}

async function getScores(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const attempt = await attemptService.findOwnedAttempt(req.params.attemptId, profile.id);
    const { rows: scores } = await db.query('SELECT * FROM score_results WHERE attempt_id = $1', [attempt.id]);
    const { rows: items } = await db.query('SELECT DISTINCT domain_code, domain_name FROM items WHERE assessment_version_id = $1', [
      attempt.assessmentVersionId,
    ]);
    const domainNames = Object.fromEntries(items.map((i) => [i.domainCode, i.domainName]));

    res.json({
      attemptId: attempt.id,
      scores: scores.map((s) => ({
        domainCode: s.domainCode,
        domainName: domainNames[s.domainCode] || s.domainCode,
        rawScore: s.scoreStatus === 'SH' ? null : Number(s.rawScore),
        completenessRate: Number(s.completenessRate),
        scoreStatus: s.scoreStatus,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { startOrResume, pause, resume, submit, getScores };
