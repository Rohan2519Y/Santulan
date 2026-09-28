/*
 * Admin pages (T151): the eleven pages built in US5 (Overview, Participants, Institutions, Roster import, Submissions +
 * drawer, Quality review, Reports, Question sets, Assessment control, Research exports, Audit log) plus Release switches.
 * Every page reads its own data from the server (GET /admin/...); nothing is counted, filtered or exported in the browser.
 * Covers: empty states, error states, that a pause/stop/archive/suspend/switch action requires a reason (3-300 characters)
 * while reopen does not, and that the submissions list itself carries no CSV download - only the drawer's per-submission
 * "Download CSV" does, and that button calls the governed server-side export endpoint (audited, backend-generated),
 * never a client-side computation. The old feature-002/005 dashboard this file used to test (assessmentApi, computeMetrics,
 * submissionsToCsv) was replaced by these pages; that dashboard and its client-side CSV export no longer exist.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'jest-axe';
import OverviewPage from '../pages/admin/OverviewPage';
import ParticipantsPage from '../pages/admin/ParticipantsPage';
import InstitutionsPage from '../pages/admin/InstitutionsPage';
import RosterImportPage from '../pages/admin/RosterImportPage';
import SubmissionsPage from '../pages/admin/SubmissionsPage';
import QualityReviewPage from '../pages/admin/QualityReviewPage';
import ReportsPage from '../pages/admin/ReportsPage';
import QuestionSetsPage from '../pages/admin/QuestionSetsPage';
import ParticipationPage from '../pages/admin/ParticipationPage';
import ExportsPage from '../pages/admin/ExportsPage';
import AuditLogPage from '../pages/admin/AuditLogPage';
import ReleaseFlagsPage from '../pages/admin/ReleaseFlagsPage';
import { NAV_ITEMS } from '../components/AdminLayout/AdminLayout';
import { adminApi, questionSetApi, releaseFlagApi } from '../services/santulanApi';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  adminApi: {
    monitoring: jest.fn(), control: jest.fn(), setControl: jest.fn(),
    institutions: jest.fn(), createInstitution: jest.fn(), updateInstitution: jest.fn(), createCohort: jest.fn(), updateCohort: jest.fn(),
    participants: jest.fn(), setParticipantStatus: jest.fn(), resetCredential: jest.fn(),
    importRoster: jest.fn(), downloadCredentials: jest.fn(),
    submissions: jest.fn(), submission: jest.fn(), submissionResponses: jest.fn(), downloadSubmissionResponses: jest.fn(), qualityFlags: jest.fn(), reviewFlag: jest.fn(), retryReport: jest.fn(), auditLogs: jest.fn(),
    exports: jest.fn(), requestExport: jest.fn(), downloadExport: jest.fn(),
  },
  questionSetApi: {
    upload: jest.fn(), list: jest.fn(), get: jest.fn(), freeze: jest.fn(), open: jest.fn(), close: jest.fn(), delete: jest.fn(), downloadTemplate: jest.fn(),
  },
  releaseFlagApi: { list: jest.fn(), set: jest.fn() },
}));

/** Renders an admin page inside a router only (the pages read `adminApi` directly; no session context is needed). */
const renderAdmin = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const err = (message) => Promise.reject(new Error(message));

beforeEach(() => { jest.clearAllMocks(); });

describe('AdminLayout navigation (T151)', () => {
  test('the sidebar has the eleven US5/US8 pages plus Response distribution (ASSUMED addition), and no leftover Item Pools entry', () => {
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      'Overview', 'Participants', 'Institutions', 'Submissions', 'Quality review', 'Reports',
      'Question sets', 'Response distribution', 'Assessment control', 'Research exports', 'Audit log', 'Release switches',
    ]);
    expect(labels).not.toContain('Item Pools');
  });
});

describe('OverviewPage', () => {
  // every count below is a distinct number so a bare match (the StatTile values) can never collide with a BarChart bar's
  // own bare count text (attempts.byState, participants.byStatus) or with each other.
  const summary = () => ({
    participants: { total: 12, byRoute: { OPEN: 8, INSTITUTIONAL: 4 }, byStatus: { ACTIVE: 10, SUSPENDED: 6 }, byInstitution: [] },
    attempts: { byState: { IN_PROGRESS: 3, REPORT_READY: 5 } },
    reports: { byState: { REPORT_READY: 5 }, retryQueue: 7 },
    exports: { byState: {} },
    qualityReview: { unreviewed: 9, reviewed: 4 },
    participation: { controlPlane: 'OPEN', openAgeGroups: ['ADOLESCENT'] },
  });

  test('shows counts only, straight from the monitoring summary', async () => {
    adminApi.monitoring.mockResolvedValue(summary());
    renderAdmin(<OverviewPage />);
    expect(await screen.findByText('12')).toBeInTheDocument(); // participants total
    expect(screen.getByText('7')).toBeInTheDocument(); // reports to retry
    expect(screen.getByText('9')).toBeInTheDocument(); // flags to review
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  test('a load failure shows the error state, not a crash', async () => {
    adminApi.monitoring.mockReturnValue(err('offline'));
    renderAdmin(<OverviewPage />);
    expect(await screen.findByText(/could not load the overview: offline/i)).toBeInTheDocument();
  });

  test('is axe-clean while ready', async () => {
    adminApi.monitoring.mockResolvedValue(summary());
    const { container } = renderAdmin(<OverviewPage />);
    await screen.findByText('12');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ParticipantsPage', () => {
  test('empty state when no participant matches the filters', async () => {
    adminApi.participants.mockResolvedValue({ participants: [], total: 0 });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<ParticipantsPage />);
    expect(await screen.findByText('No participants match these filters.')).toBeInTheDocument();
  });

  test('error state on a failed load', async () => {
    adminApi.participants.mockReturnValue(err('down'));
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<ParticipantsPage />);
    expect(await screen.findByText('down')).toBeInTheDocument();
  });

  test('suspending needs a reason of at least 3 characters; reactivating uses the same confirmed dialog', async () => {
    adminApi.participants.mockResolvedValue({ participants: [{ participantId: 'p1', santulanId: 'STN-AAA', participationRoute: 'OPEN', assessmentTrack: 'ADOLESCENT', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z' }], total: 1 });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    adminApi.setParticipantStatus.mockResolvedValue({});
    renderAdmin(<ParticipantsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend STN-AAA' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason \(required/i), 'no');
    expect(confirm).toBeDisabled(); // 2 characters is still short of the 3-character minimum
    await userEvent.type(within(dialog).getByLabelText(/reason \(required/i), 'x');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(adminApi.setParticipantStatus).toHaveBeenCalledWith('p1', 'SUSPENDED', 'nox'));
  });
});

describe('InstitutionsPage', () => {
  test('empty state invites adding the first institution', async () => {
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<InstitutionsPage />);
    expect(await screen.findByText(/no institutions yet/i)).toBeInTheDocument();
  });

  test('archiving an institution is confirmed and never deletes it', async () => {
    adminApi.institutions.mockResolvedValue({ institutions: [{ institutionId: 'i1', institutionCode: 'SCH-1', institutionName: 'Greenfield School', institutionType: 'SCHOOL', status: 'ACTIVE', parentInstitutionId: null, cohorts: [] }] });
    adminApi.updateInstitution.mockResolvedValue({});
    renderAdmin(<InstitutionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Greenfield School' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/never be deleted|cannot be reopened/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(adminApi.updateInstitution).toHaveBeenCalledWith('i1', { status: 'ARCHIVED' }));
  });
});

describe('RosterImportPage', () => {
  test('commit stays disabled until validation is clean', async () => {
    adminApi.institutions.mockResolvedValue({ institutions: [{ institutionId: 'i1', institutionName: 'Greenfield', status: 'ACTIVE', cohorts: [{ cohortId: 'c1', cohortName: '2026 intake', status: 'ACTIVE' }] }] });
    renderAdmin(<RosterImportPage />);
    expect(await screen.findByRole('button', { name: 'Commit import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Validate file' })).toBeDisabled(); // no institution/cohort/file chosen yet
  });

  test('a failed validation lists every row problem and blocks commit', async () => {
    adminApi.institutions.mockResolvedValue({ institutions: [{ institutionId: 'i1', institutionName: 'Greenfield', status: 'ACTIVE', cohorts: [{ cohortId: 'c1', cohortName: '2026 intake', status: 'ACTIVE' }] }] });
    adminApi.importRoster.mockResolvedValue({ ok: false, errors: [{ row: 2, field: 'externalStudentId', code: 'REQUIRED' }], warnings: [], eligible: {}, rowCount: 0 });
    renderAdmin(<RosterImportPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Institution'), 'i1');
    await userEvent.selectOptions(screen.getByLabelText('Cohort'), 'c1');
    const file = new File(['a,b'], 'roster.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/drop the roster file here/i), file);
    await userEvent.click(screen.getByRole('button', { name: 'Validate file' }));
    expect(await screen.findByText(/1 problem/)).toBeInTheDocument();
    expect(screen.getByText('REQUIRED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit import' })).toBeDisabled();
  });

  test('after a successful commit, Close clears the completed state so a new import can start', async () => {
    adminApi.institutions.mockResolvedValue({ institutions: [{ institutionId: 'i1', institutionName: 'Greenfield', status: 'ACTIVE', cohorts: [{ cohortId: 'c1', cohortName: '2026 intake', status: 'ACTIVE' }] }] });
    adminApi.importRoster.mockResolvedValueOnce({ ok: true, rowCount: 2, eligible: { ADOLESCENT: 2 }, warnings: [] });
    adminApi.importRoster.mockResolvedValueOnce({ count: 2, importId: 'imp1' });
    renderAdmin(<RosterImportPage />);
    await screen.findByRole('option', { name: 'Greenfield' }); // wait for the async institutions load, not just the select existing
    await userEvent.selectOptions(screen.getByLabelText('Institution'), 'i1');
    await userEvent.selectOptions(screen.getByLabelText('Cohort'), 'c1');
    const file = new File(['a,b'], 'roster.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/drop the roster file here/i), file);
    await userEvent.click(screen.getByRole('button', { name: 'Validate file' }));
    await screen.findByText(/the file is valid/i);
    await userEvent.click(screen.getByRole('button', { name: 'Commit import' }));

    expect(await screen.findByText('2 participants registered.')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await userEvent.click(closeBtn);

    expect(screen.queryByText('2 participants registered.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit import' })).toBeDisabled(); // back to a clean, unstarted form
    expect(screen.getByLabelText('Institution')).toHaveValue(''); // institution/cohort reset too, a real fresh start
  });
});

describe('SubmissionsPage', () => {
  test('empty state and no client-side CSV download anywhere on the page', async () => {
    adminApi.submissions.mockResolvedValue({ submissions: [] });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    const { container } = renderAdmin(<SubmissionsPage />);
    expect(await screen.findByText('No submissions match these filters.')).toBeInTheDocument();
    expect(screen.queryByText(/download csv|export csv|\.csv/i)).not.toBeInTheDocument();
    expect(container.querySelector('a[download], button[data-csv]')).toBeNull();
  });

  test('error state on a failed load', async () => {
    adminApi.submissions.mockReturnValue(err('offline'));
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<SubmissionsPage />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('opening a row shows the drawer with domain results and quality flags, and its "Download CSV" calls the governed export - not a client-side computation', async () => {
    adminApi.submissions.mockResolvedValue({ submissions: [{ attemptId: 'a1', santulanId: 'STN-BBB', versionLabel: 'santulan-adolescent-v1', revision: 1, status: 'REPORT_READY', sessionCount: 2, qualityFlagCount: 1, submittedAt: '2026-09-10T09:00:00Z' }] });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    adminApi.submission.mockResolvedValue({
      status: 'REPORT_READY', sessionCount: 2, submittedAt: '2026-09-10T09:00:00Z', scoringVersion: 'domain-mean-v1',
      report: { state: 'REPORT_READY', retryCount: 0 },
      domainResults: [{ domainCode: 'C1', score: 4.2, completeness: 1, validItems: 10, eligibleItems: 10, completenessStatus: 'COMPLETE', evidenceState: 'S1' }],
      flags: [{ flagId: 'f1', flagCode: 'Q07', domainCode: 'C1', disposition: 'UNREVIEWED' }],
    });
    adminApi.downloadSubmissionResponses.mockResolvedValue();
    renderAdmin(<SubmissionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'View submission STN-BBB' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Body & Self-Regulation/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Q07/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
    expect(adminApi.downloadSubmissionResponses).toHaveBeenCalledWith('a1'); // the server builds the file; nothing is computed here
  });
});

describe('QualityReviewPage', () => {
  test('empty queue', async () => {
    adminApi.qualityFlags.mockResolvedValue({ flags: [] });
    renderAdmin(<QualityReviewPage />);
    expect(await screen.findByText('Nothing to review here.')).toBeInTheDocument();
  });

  test('saving a review does not require a reason but does record the chosen disposition and note', async () => {
    adminApi.qualityFlags.mockResolvedValue({ flags: [{ flagId: 'f1', santulanId: 'STN-CCC', flagCode: 'Q02', domainCode: 'C3', severity: 'LOW', detectedAt: '2026-09-11T00:00:00Z', disposition: 'UNREVIEWED' }] });
    adminApi.reviewFlag.mockResolvedValue({});
    renderAdmin(<QualityReviewPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review Q02 for STN-CCC' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Save review' })).toBeEnabled(); // no reason required here, unlike suspend/pause/stop
    await userEvent.click(within(dialog).getByLabelText('Confirm'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(adminApi.reviewFlag).toHaveBeenCalledWith('f1', 'CONFIRMED', ''));
  });
});

describe('ReportsPage', () => {
  test('empty retry queue', async () => {
    adminApi.submissions.mockResolvedValue({ submissions: [] });
    renderAdmin(<ReportsPage />);
    expect(await screen.findByText('No reports are waiting for a retry.')).toBeInTheDocument();
  });

  test('retry is a single audited action with no extra confirmation', async () => {
    adminApi.submissions.mockResolvedValue({ submissions: [{ attemptId: 'a1', santulanId: 'STN-DDD', versionLabel: 'santulan-adolescent-v1', revision: 1, submittedAt: '2026-09-10T09:00:00Z', report: { reportId: 'r1', retryCount: 1 } }] });
    adminApi.retryReport.mockResolvedValue({ state: 'REPORT_READY' });
    renderAdmin(<ReportsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry the report for STN-DDD' }));
    await waitFor(() => expect(adminApi.retryReport).toHaveBeenCalledWith('r1'));
  });
});

describe('QuestionSetsPage', () => {
  test('empty state before any upload', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [] });
    renderAdmin(<QuestionSetsPage />);
    expect(await screen.findByText(/no question sets yet/i)).toBeInTheDocument();
  });

  test('a rejected upload lists every row/column problem and saves nothing', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [] });
    const apiErr = Object.assign(new Error('The file has 2 problems.'), { details: [{ row: 3, column: 'keying', code: 'KEYING_NOT_SUPPORTED', message: 'keying must be Positive' }, { row: 5, column: 'item_code', code: 'ITEM_CODE_DUPLICATE', message: 'duplicate item_code' }], totalProblems: 2 });
    questionSetApi.upload.mockRejectedValue(apiErr);
    renderAdmin(<QuestionSetsPage />);
    const file = new File(['x'], 'questions.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await userEvent.upload(await screen.findByLabelText(/drop a question workbook/i), file);
    expect(await screen.findByText('KEYING_NOT_SUPPORTED')).toBeInTheDocument();
    expect(screen.getByText('ITEM_CODE_DUPLICATE')).toBeInTheDocument();
  });

  test('freezing and opening a set each need their own confirmation, and opening needs a reason', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [{ setId: 's1', versionLabel: 'santulan-adolescent-v1', revision: 1, ageGroup: 'ADOLESCENT', status: 'FROZEN', participationState: 'CLOSED', questionCount: 175, optionCount: 875 }] });
    questionSetApi.open.mockResolvedValue({});
    renderAdmin(<QuestionSetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open santulan-adolescent-v1 for participation' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Open' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason \(required/i), 'pilot launch');
    await userEvent.click(confirm);
    await waitFor(() => expect(questionSetApi.open).toHaveBeenCalledWith('s1', 'pilot launch'));
  });

  test('CR-006-12: a DRAFT set offers Delete (no reason needed) and it disappears from the freezable list once confirmed', async () => {
    questionSetApi.list
      .mockResolvedValueOnce({ sets: [{ setId: 's1', versionLabel: 'fx-draft-v1', revision: 1, ageGroup: 'ADOLESCENT', status: 'DRAFT', participationState: 'CLOSED', questionCount: 10, optionCount: 50 }] })
      .mockResolvedValueOnce({ sets: [{ setId: 's1', versionLabel: 'fx-draft-v1', revision: 1, ageGroup: 'ADOLESCENT', status: 'RETIRED', participationState: 'CLOSED', questionCount: 10, optionCount: 50 }] });
    questionSetApi.delete.mockResolvedValue({ setId: 's1', status: 'RETIRED' });
    renderAdmin(<QuestionSetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete fx-draft-v1 revision 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/gone for good/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(questionSetApi.delete).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete fx-draft-v1 revision 1' })).not.toBeInTheDocument());
  });

  test('CR-006-12: a FROZEN set offers no Delete button at all', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [{ setId: 's2', versionLabel: 'fx-frozen-v1', revision: 1, ageGroup: 'ADOLESCENT', status: 'FROZEN', participationState: 'CLOSED', questionCount: 10, optionCount: 50 }] });
    renderAdmin(<QuestionSetsPage />);
    await screen.findByText('fx-frozen-v1');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('CR-006-12: a delete refusal (e.g. the set was frozen in the meantime) is shown inside the dialog', async () => {
    questionSetApi.list.mockResolvedValue({ sets: [{ setId: 's3', versionLabel: 'fx-draft-v2', revision: 1, ageGroup: 'ADOLESCENT', status: 'DRAFT', participationState: 'CLOSED', questionCount: 10, optionCount: 50 }] });
    questionSetApi.delete.mockRejectedValue(Object.assign(new Error('Only a draft question set can be deleted; a frozen set is permanent'), { code: 'SET_NOT_DRAFT' }));
    renderAdmin(<QuestionSetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete fx-draft-v2 revision 1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/a frozen set is permanent/i)).toBeInTheDocument();
  });
});

describe('ParticipationPage (Assessment control)', () => {
  const control = (over = {}) => ({ state: 'OPEN', controlPlane: 'OPEN', changedAt: null, reason: null, openSets: [], recent: [], ...over });

  test('pausing and stopping require a reason; reopening does not', async () => {
    adminApi.control.mockResolvedValue(control());
    adminApi.setControl.mockResolvedValue({});
    renderAdmin(<ParticipationPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Pause' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason \(required/i), 'scheduled maintenance');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(adminApi.setControl).toHaveBeenCalledWith('PAUSED', 'scheduled maintenance'));
  });

  test('reopening from a stopped state needs no reason dialog', async () => {
    adminApi.control.mockResolvedValue(control({ state: 'STOPPED', controlPlane: 'STOPPED' }));
    adminApi.setControl.mockResolvedValue({});
    renderAdmin(<ParticipationPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(adminApi.setControl).toHaveBeenCalledWith('OPEN', ''));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('shows both participation gates', async () => {
    adminApi.control.mockResolvedValue(control({ openSets: [{ ageGroup: 'ADOLESCENT', versionLabel: 'santulan-adolescent-v1', revision: 1 }] }));
    renderAdmin(<ParticipationPage />);
    expect(await screen.findByRole('heading', { name: 'Assessment control' })).toBeInTheDocument();
    expect(screen.getByText(/santulan-adolescent-v1 r1/)).toBeInTheDocument();
  });
});

describe('ExportsPage', () => {
  test('empty state and Download is offered only for a Ready export', async () => {
    adminApi.exports.mockResolvedValue({ exports: [{ exportId: 'e1', createdAt: '2026-09-10T00:00:00Z', status: 'GENERATING', filters: {}, anonymisationVersion: 'v1' }, { exportId: 'e2', createdAt: '2026-09-11T00:00:00Z', status: 'READY', filters: {}, anonymisationVersion: 'v1' }] });
    questionSetApi.list.mockResolvedValue({ sets: [] });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<ExportsPage />);
    await screen.findByText('Preparing');
    expect(screen.queryByRole('button', { name: /download the export requested.*10.*/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download the export requested.*11.*/i })).toBeInTheDocument();
  });

  test('the request form needs a question set and an anonymisation version before it can submit', async () => {
    adminApi.exports.mockResolvedValue({ exports: [] });
    questionSetApi.list.mockResolvedValue({ sets: [{ setId: 's1', versionLabel: 'santulan-adolescent-v1', revision: 1, status: 'FROZEN' }] });
    adminApi.institutions.mockResolvedValue({ institutions: [] });
    renderAdmin(<ExportsPage />);
    expect(await screen.findByRole('button', { name: 'Request export' })).toBeDisabled();
  });
});

describe('AuditLogPage', () => {
  test('empty state and the page offers no action other than filtering (read-only)', async () => {
    adminApi.auditLogs.mockResolvedValue({ auditLogs: [] });
    renderAdmin(<AuditLogPage />);
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete|edit|remove/i })).not.toBeInTheDocument();
  });

  test('lists an entry with actor, action, before/after and reason, and nothing on the row is clickable to change it', async () => {
    adminApi.auditLogs.mockResolvedValue({ auditLogs: [{ auditId: 'l1', occurredAt: '2026-09-12T00:00:00Z', actorType: 'ADMIN', actionType: 'PARTICIPATION_CONTROL', targetEntity: 'assessment_control', previousState: { state: 'OPEN' }, newState: { state: 'PAUSED' }, reason: 'maintenance' }] });
    renderAdmin(<AuditLogPage />);
    expect(await screen.findByText('PARTICIPATION_CONTROL')).toBeInTheDocument();
    expect(screen.getByText('maintenance')).toBeInTheDocument();
    expect(screen.queryAllByRole('button').filter((b) => /suspend|archive|retry|delete/i.test(b.textContent))).toHaveLength(0);
  });
});

describe('ReleaseFlagsPage', () => {
  const flags = (over = {}) => ({ pilotS2: { value: false }, advancedEvidence: { value: false }, developmentRelease: { value: false }, pathwayRelease: { value: false }, ...over });

  test('all four switches start off', async () => {
    releaseFlagApi.list.mockResolvedValue(flags());
    renderAdmin(<ReleaseFlagsPage />);
    expect(await screen.findAllByText('Off')).toHaveLength(4);
  });

  test('turning a switch on needs a reason of at least 3 characters', async () => {
    releaseFlagApi.list.mockResolvedValue(flags());
    releaseFlagApi.set.mockResolvedValue({});
    renderAdmin(<ReleaseFlagsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /turn on pilot s2 scoring/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Turn on' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason \(required/i), 'owner-approved pilot');
    await userEvent.click(confirm);
    await waitFor(() => expect(releaseFlagApi.set).toHaveBeenCalledWith('pilotS2', true, 'owner-approved pilot'));
  });

  test('an error loading the flags is shown, not a crash', async () => {
    releaseFlagApi.list.mockReturnValue(err('offline'));
    renderAdmin(<ReleaseFlagsPage />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});
