const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const importService = require('../services/import.service');
const participationService = require('../services/participation.service');
const { setAdminBypass } = require('../../../shared/utils/rls');

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // contracts/item-pool-schema.md: max file size 2 MB

async function importItemPool(req, res, next) {
  try {
    if (!req.file) {
      throw new HttpError(415, 'INVALID_FILE_TYPE', 'A file field named "file" is required');
    }
    if (req.file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'File exceeds the 2 MB limit');
    }
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      throw new HttpError(415, 'INVALID_FILE_TYPE', 'File must be a .xlsx workbook');
    }

    const { rows: scaleRows } = await db.query("SELECT * FROM response_scales WHERE status = 'FROZEN' LIMIT 1");
    const scale = scaleRows[0];
    if (!scale) {
      throw new HttpError(409, 'ATTEMPT_UNAVAILABLE', 'No frozen response scale configured; seed the database first');
    }

    const { version, itemCount, reimported } = await importService.importItemPool({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      adminUserId: req.user.id,
      responseScaleId: scale.id,
    });

    res.status(201).json({
      import: { id: version.id, status: 'accepted' },
      version: { id: version.id, versionLabel: version.versionLabel, itemCount, active: version.isActive, reimported: !!reimported },
    });
  } catch (err) {
    next(err);
  }
}

async function control(req, res, next) {
  try {
    const record = await participationService.recordControl(req.user.id, req.body);
    res.status(201).json({ control: { action: record.action, reason: record.reason, actorId: record.actorId, createdAt: record.createdAt } });
  } catch (err) {
    next(err);
  }
}

async function listSubmissions(req, res, next) {
  try {
    const { rows: attempts } = await db.query(
      `SELECT aa.*, pp.santulan_id, av.version_label
       FROM assessment_attempts aa
       JOIN participant_profiles pp ON pp.id = aa.participant_profile_id
       JOIN assessment_versions av ON av.id = aa.assessment_version_id
       ORDER BY aa.created_at DESC
       LIMIT 200`
    );

    const attemptIds = attempts.map((a) => a.id);
    const { rows: allScores } = attemptIds.length
      ? await db.query('SELECT * FROM score_results WHERE attempt_id = ANY($1)', [attemptIds])
      : { rows: [] };
    const { rows: allFlags } = attemptIds.length
      ? await db.query('SELECT * FROM quality_flags WHERE attempt_id = ANY($1)', [attemptIds])
      : { rows: [] };

    const scoresByAttempt = new Map();
    for (const s of allScores) {
      if (!scoresByAttempt.has(s.attemptId)) scoresByAttempt.set(s.attemptId, []);
      scoresByAttempt.get(s.attemptId).push(s);
    }
    const flagCountByAttempt = new Map();
    for (const f of allFlags) {
      flagCountByAttempt.set(f.attemptId, (flagCountByAttempt.get(f.attemptId) || 0) + 1);
    }

    res.json({
      submissions: attempts.map((a) => ({
        attemptId: a.id,
        santulanId: a.santulanId,
        versionLabel: a.versionLabel,
        status: a.status,
        submittedAt: a.submittedAt,
        completedAt: a.completedAt,
        sessionCount: a.sessionCount,
        scoreSummary: (scoresByAttempt.get(a.id) || []).map((s) => ({ domainCode: s.domainCode, scoreStatus: s.scoreStatus })),
        qualityFlagCount: flagCountByAttempt.get(a.id) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getSubmissionDetail(req, res, next) {
  try {
    const { rows: attemptRows } = await db.query(
      `SELECT aa.*, pp.santulan_id, av.version_label
       FROM assessment_attempts aa
       JOIN participant_profiles pp ON pp.id = aa.participant_profile_id
       JOIN assessment_versions av ON av.id = aa.assessment_version_id
       WHERE aa.id = $1`,
      [req.params.attemptId]
    );
    const attempt = attemptRows[0];
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

    const [responses, scores, qualityFlags, reportRows] = await Promise.all([
      db.withTransaction(async (tx) => {
        await setAdminBypass(tx);
        const { rows } = await tx.query(
          `SELECT r.*, i.item_code, i.domain_code
           FROM responses r
           JOIN items i ON i.id = r.item_id
           WHERE r.attempt_id = $1 AND r.is_current = true`,
          [attempt.id]
        );
        return rows;
      }),
      db.query('SELECT * FROM score_results WHERE attempt_id = $1', [attempt.id]).then((r) => r.rows),
      db.query('SELECT * FROM quality_flags WHERE attempt_id = $1', [attempt.id]).then((r) => r.rows),
      db.query('SELECT * FROM reports WHERE attempt_id = $1', [attempt.id]).then((r) => r.rows),
    ]);
    const report = reportRows[0] || null;

    res.json({
      attempt: {
        id: attempt.id,
        santulanId: attempt.santulanId,
        versionLabel: attempt.versionLabel,
        status: attempt.status,
        sessionCount: attempt.sessionCount,
      },
      responses: responses.map((r) => ({
        itemCode: r.itemCode,
        domainCode: r.domainCode,
        value: r.responseValue,
        responseVersion: r.responseVersion,
        answeredAt: r.answeredAt,
      })),
      scores: scores.map((s) => ({
        domainCode: s.domainCode,
        rawScore: Number(s.rawScore),
        completenessRate: Number(s.completenessRate),
        scoreStatus: s.scoreStatus,
      })),
      qualityFlags: qualityFlags.map((f) => ({
        id: f.id,
        flagCode: f.flagCode,
        domainCode: f.domainCode,
        severity: f.severity,
        disposition: f.disposition,
        reviewedAt: f.reviewedAt,
      })),
      report: report ? { id: report.id, generationStatus: report.generationStatus, retryCount: report.retryCount } : null,
    });
  } catch (err) {
    next(err);
  }
}

async function reviewQualityFlag(req, res, next) {
  try {
    const { rows: flagRows } = await db.query('SELECT * FROM quality_flags WHERE id = $1', [req.params.flagId]);
    const flag = flagRows[0];
    if (!flag) throw new HttpError(404, 'NOT_FOUND', 'Quality flag not found');

    const { rows: updatedRows } = await db.query(
      `UPDATE quality_flags SET disposition = $1, reviewed_by = $2, reviewed_at = $3 WHERE id = $4 RETURNING *`,
      [req.body.disposition, req.user.id, new Date(), flag.id]
    );
    const updated = updatedRows[0];

    res.json({
      qualityFlag: { id: updated.id, flagCode: updated.flagCode, disposition: updated.disposition, reviewedAt: updated.reviewedAt },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { importItemPool, control, listSubmissions, getSubmissionDetail, reviewQualityFlag };
