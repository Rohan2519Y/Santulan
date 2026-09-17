const prisma = require('../../../shared/prisma');
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

    const scale = await prisma.responseScale.findFirst({ where: { status: 'FROZEN' } });
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
    const attempts = await prisma.assessmentAttempt.findMany({
      include: {
        participantProfile: { select: { santulanId: true } },
        assessmentVersion: { select: { versionLabel: true } },
        scoreResults: true,
        qualityFlags: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({
      submissions: attempts.map((a) => ({
        attemptId: a.id,
        santulanId: a.participantProfile.santulanId,
        versionLabel: a.assessmentVersion.versionLabel,
        status: a.status,
        submittedAt: a.submittedAt,
        completedAt: a.completedAt,
        sessionCount: a.sessionCount,
        scoreSummary: a.scoreResults.map((s) => ({ domainCode: s.domainCode, scoreStatus: s.scoreStatus })),
        qualityFlagCount: a.qualityFlags.length,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getSubmissionDetail(req, res, next) {
  try {
    const attempt = await prisma.assessmentAttempt.findUnique({
      where: { id: req.params.attemptId },
      include: {
        participantProfile: { select: { santulanId: true } },
        assessmentVersion: { select: { versionLabel: true } },
      },
    });
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

    const [responses, scores, qualityFlags, report] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await setAdminBypass(tx);
        return tx.response.findMany({ where: { attemptId: attempt.id, isCurrent: true }, include: { item: true } });
      }),
      prisma.scoreResult.findMany({ where: { attemptId: attempt.id } }),
      prisma.qualityFlag.findMany({ where: { attemptId: attempt.id } }),
      prisma.report.findUnique({ where: { attemptId: attempt.id } }),
    ]);

    res.json({
      attempt: {
        id: attempt.id,
        santulanId: attempt.participantProfile.santulanId,
        versionLabel: attempt.assessmentVersion.versionLabel,
        status: attempt.status,
        sessionCount: attempt.sessionCount,
      },
      responses: responses.map((r) => ({
        itemCode: r.item.itemCode,
        domainCode: r.item.domainCode,
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
    const flag = await prisma.qualityFlag.findUnique({ where: { id: req.params.flagId } });
    if (!flag) throw new HttpError(404, 'NOT_FOUND', 'Quality flag not found');

    const updated = await prisma.qualityFlag.update({
      where: { id: flag.id },
      data: { disposition: req.body.disposition, reviewedById: req.user.id, reviewedAt: new Date() },
    });

    res.json({
      qualityFlag: { id: updated.id, flagCode: updated.flagCode, disposition: updated.disposition, reviewedAt: updated.reviewedAt },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { importItemPool, control, listSubmissions, getSubmissionDetail, reviewQualityFlag };
