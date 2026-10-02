/*
 * Admin endpoints (contracts/api.md section 6): assessment control, institutions, cohorts, participants, monitoring, quality review and
 * the audit log. Active SUPER_ADMIN only (the route guard re-checks the database on every request). Request bodies are strict; the actor
 * always comes from the verified token, never from the request.
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const { strictObject } = require('../middleware/http');
const control = require('../services/admin/controlService');
const institutions = require('../services/admin/institutionService');
const cohorts = require('../services/admin/cohortService');
const participantAdmin = require('../services/admin/participantAdminService');
const monitoring = require('../services/admin/monitoringService');
const dashboard = require('../services/admin/dashboardService');
const qualityReview = require('../services/admin/qualityReviewService');
const auditLog = require('../services/admin/auditLogService');
const submissions = require('../services/admin/submissionService');
const pilotReport = require('../services/reporting/pilotReport/pilotReportService');
const rules = require('../services/domain/adminRules');

const wrap = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (err) { next(err); } };
const wrapCreated = (fn) => async (req, res, next) => { try { res.status(201).json(await fn(req)); } catch (err) { next(err); } };
const uuid = z.string().uuid();
const idParam = (req, what) => {
  const parsed = uuid.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'NOT_FOUND', `${what} not found`);
  return parsed.data;
};
const actor = (req) => req.actor;

const controlSchema = strictObject({ state: z.enum(rules.CONTROL_STATES), reason: z.string().max(400).optional() });
const institutionCreateSchema = strictObject({
  institutionCode: z.string().trim().min(2).max(40), institutionName: z.string().trim().min(2).max(200), institutionType: z.enum(rules.INSTITUTION_TYPES), parentInstitutionId: uuid.nullable().optional(),
});
const institutionUpdateSchema = strictObject({
  institutionName: z.string().trim().min(2).max(200).optional(), institutionType: z.enum(rules.INSTITUTION_TYPES).optional(), parentInstitutionId: uuid.nullable().optional(), status: z.enum(rules.ENTITY_STATUSES).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const cohortCreateSchema = strictObject({
  institutionId: uuid, cohortCode: z.string().trim().min(2).max(40), cohortName: z.string().trim().min(2).max(200), academicYear: z.string().trim().max(20).optional(),
  developmentalBand: z.enum(['D1', 'D2', 'D3', 'D4']).optional(), educationStage: z.string().trim().max(60).optional(),
});
const cohortUpdateSchema = strictObject({
  cohortName: z.string().trim().min(2).max(200).optional(), academicYear: z.string().trim().max(20).nullable().optional(), developmentalBand: z.enum(['D1', 'D2', 'D3', 'D4']).nullable().optional(),
  educationStage: z.string().trim().max(60).nullable().optional(), status: z.enum(rules.ENTITY_STATUSES).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const participantStatusSchema = strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().max(400) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dashboardQuerySchema = z.object({
  assessmentVersionId: uuid.optional(), institutionId: uuid.optional(), cohortId: uuid.optional(),
  dateFrom: isoDate.optional(), dateTo: isoDate.optional(), days: z.string().regex(/^\d+$/).optional(),
});
const flagReviewSchema = strictObject({ disposition: z.enum(['DISMISSED', 'CONFIRMED', 'ESCALATED']), note: z.string().trim().max(500).optional() });

/** Draft PDF from the ported pilot-kit engine (santulan_pilot_kit's own report generator, reimplemented in
 * src/services/reporting/pilotReport/), for one attempt. Separate from our own in-app report pipeline. */
const pilotReportPdf = async (req, res, next) => {
  let file = null;
  try {
    const result = await pilotReport.generateForAttempt(actor(req), idParam(req, 'Attempt'));
    file = result.file;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.reportId}.pdf"`);
    res.sendFile(file, (err) => { pilotReport.cleanup(file); if (err && !res.headersSent) next(err); });
  } catch (err) {
    if (file) pilotReport.cleanup(file);
    next(err);
  }
};

module.exports = {
  controlSchema, institutionCreateSchema, institutionUpdateSchema, cohortCreateSchema, cohortUpdateSchema, participantStatusSchema, flagReviewSchema,
  pilotReportPdf,
  getControl: wrap((req) => control.read(actor(req))),
  setControl: wrap((req) => control.setState(actor(req), req.body, req.correlationId)),
  listInstitutions: wrap((req) => institutions.list(actor(req))),
  createInstitution: wrapCreated((req) => institutions.create(actor(req), req.body, req.correlationId)),
  updateInstitution: wrap((req) => institutions.update(actor(req), idParam(req, 'Institution'), req.body, req.correlationId)),
  listCohorts: wrap((req) => cohorts.list(actor(req), req.query.institutionId ? { institutionId: uuid.parse(req.query.institutionId) } : {})),
  createCohort: wrapCreated((req) => cohorts.create(actor(req), req.body, req.correlationId)),
  updateCohort: wrap((req) => cohorts.update(actor(req), idParam(req, 'Cohort'), req.body, req.correlationId)),
  listParticipants: wrap((req) => participantAdmin.list(actor(req), req.query)),
  setParticipantStatus: wrap((req) => participantAdmin.setStatus(actor(req), idParam(req, 'Participant'), req.body, req.correlationId)),
  monitoringSummary: wrap((req) => monitoring.summary(actor(req))),
  dashboardSummary: wrap((req) => dashboard.dashboard(actor(req), dashboardQuerySchema.parse(req.query))),
  listQualityFlags: wrap((req) => qualityReview.list(actor(req), req.query)),
  reviewQualityFlag: wrap((req) => qualityReview.review(actor(req), idParam(req, 'Quality flag'), req.body, req.correlationId)),
  listAuditLogs: wrap((req) => auditLog.list(actor(req), req.query)),
  listSubmissions: wrap((req) => submissions.list(actor(req), req.query)),
  submissionDetail: wrap((req) => submissions.detail(actor(req), idParam(req, 'Submission'))),
  submissionResponses: wrap((req) => submissions.responses(actor(req), idParam(req, 'Submission'), req.correlationId)),
  exportSubmissionResponses: async (req, res, next) => {
    try {
      const attemptId = idParam(req, 'Submission');
      const { santulanId, csv } = await submissions.exportResponsesCsv(actor(req), attemptId, req.correlationId);
      const fileTag = (santulanId || attemptId).replace(/[^A-Za-z0-9_-]/g, '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="santulan-answers-${fileTag}.csv"`);
      res.send(csv);
    } catch (err) { next(err); }
  },
};
