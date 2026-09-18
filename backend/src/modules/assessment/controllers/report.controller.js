const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const profileService = require('../services/profile.service');
const { retryReportGeneration } = require('../services/report.service');

async function findOwnedReport(reportId, participantProfileId) {
  const { rows } = await db.query('SELECT * FROM reports WHERE id = $1', [reportId]);
  const report = rows[0];
  if (!report) {
    throw new HttpError(404, 'REPORT_NOT_READY', 'Report not found or not generated yet');
  }
  if (report.participantProfileId !== participantProfileId) {
    throw new HttpError(403, 'FORBIDDEN', 'Report does not belong to the caller');
  }
  return report;
}

async function getReport(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const report = await findOwnedReport(req.params.reportId, profile.id);

    const { rows: sections } = await db.query(
      'SELECT * FROM report_sections WHERE report_id = $1 AND is_released_to_participant = true ORDER BY display_order ASC',
      [report.id]
    );

    res.json({
      reportId: report.id,
      releasedSections: sections.map((s) => ({
        sectionType: s.sectionType,
        domainCode: s.domainCode,
        content: s.contentSnapshot,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function retryReport(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    const report = await findOwnedReport(req.params.reportId, profile.id);
    const updated = await retryReportGeneration(report, req.user.id, req.body?.reason);
    res.json({ report: { id: updated.id, generationStatus: updated.generationStatus, retryCount: updated.retryCount } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getReport, retryReport };
