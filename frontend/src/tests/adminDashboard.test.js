import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'jest-axe';
import * as api from '../services/assessmentApi';
import AdminDashboard from '../pages/admin/AdminDashboard';
import BarChart from '../components/BarChart/BarChart';
import Modal from '../components/Modal/Modal';
import {
  computeMetrics,
  filterSubmissions,
  sortSubmissions,
  paginate,
  submissionsToCsv,
  needsAttention,
} from '../pages/admin/adminMetrics';

jest.mock('../services/assessmentApi');

const ADOL = 'santulan-adolescent-pilot-v1.0';
const EMER = 'santulan-emergingadult-pilot-v1.0';

const mk = (i, over = {}) => ({
  attemptId: `a${i}`,
  santulanId: `STLN-${String(i).padStart(4, '0')}`,
  versionLabel: i % 3 === 0 ? EMER : ADOL,
  status: 'REPORT_READY',
  submittedAt: `2026-09-${String(10 + i).padStart(2, '0')}T09:00:00.000Z`,
  completedAt: `2026-09-${String(10 + i).padStart(2, '0')}T09:30:00.000Z`,
  sessionCount: 1,
  qualityFlagCount: 0,
  ...over,
});

// 12 submissions: REPORT_READY x6, IN_PROGRESS x2, PAUSED, QUALITY_HOLD (2 flags), INVALID, SCORED.
const SUBMISSIONS = [
  mk(1), mk(2), mk(3), mk(4), mk(5),
  mk(6, { status: 'IN_PROGRESS', submittedAt: null, completedAt: null }),
  mk(7, { status: 'IN_PROGRESS', submittedAt: null, completedAt: null }),
  mk(8, { status: 'PAUSED', submittedAt: null, completedAt: null }),
  mk(9, { status: 'QUALITY_HOLD', qualityFlagCount: 2 }),
  mk(10, { qualityFlagCount: 1 }),
  mk(11, { status: 'INVALID' }),
  mk(12, { status: 'SCORED' }),
];

const DETAIL = {
  attempt: { id: 'a9', santulanId: 'STLN-0009', versionLabel: EMER, status: 'QUALITY_HOLD', sessionCount: 2 },
  responses: [{ itemCode: 'C1-01' }, { itemCode: 'C1-02' }, { itemCode: 'C2-01' }],
  scores: [
    { domainCode: 'C1', rawScore: 3.5, completenessRate: 1, scoreStatus: 'S3' },
    { domainCode: 'C2', rawScore: null, completenessRate: 0.4, scoreStatus: 'SH' },
  ],
  qualityFlags: [
    { id: 'f1', flagCode: 'Q03', severity: 'HIGH', disposition: null },
    { id: 'f2', flagCode: 'Q07', severity: 'LOW', disposition: 'Checked, fine' },
  ],
};

const renderAt = (path = '/admin') =>
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/admin/*" element={<AdminDashboard />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );

// A StatTile's own label (the same words also appear in chart pills and table headers).
const tile = (label) => screen.getAllByText(label).find((el) => el.className === 'label').closest('div').parentElement;

beforeEach(() => {
  jest.resetAllMocks();
  api.getSubmissions.mockResolvedValue({ submissions: SUBMISSIONS });
  api.getSubmissionDetail.mockResolvedValue(DETAIL);
  api.reviewQualityFlag.mockResolvedValue({});
  api.controlParticipation.mockImplementation(async ({ action, reason }) => ({ control: { action, reason: reason || null, createdAt: '2026-09-19T10:00:00.000Z' } }));
  api.getUser.mockReturnValue({ name: 'Santulan Admin', email: 'admin@santulan.local', role: 'superuser' });
  api.getLastControl.mockReturnValue(null);
});

/* ------------------------------------------------------------------ pure logic */
describe('adminMetrics', () => {
  test('headline numbers', () => {
    const m = computeMetrics(SUBMISSIONS);
    expect(m).toMatchObject({ total: 12, inProgress: 3, completed: 7, needsAttention: 3, flagsTotal: 3 });
    expect(m.byStatus.find((s) => s.key === 'REPORT_READY').count).toBe(6);
    expect(m.byStatus.map((s) => s.key)).toEqual(['IN_PROGRESS', 'PAUSED', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID']); // lifecycle order, zero rows omitted
    expect(m.byVersion).toEqual([{ label: ADOL, count: 8 }, { label: EMER, count: 4 }]);
    expect(m.recent).toHaveLength(5);
  });

  test('needs attention = flags, quality hold or invalid', () => {
    expect(SUBMISSIONS.filter(needsAttention).map((s) => s.attemptId)).toEqual(['a9', 'a10', 'a11']);
  });

  test('filtering by search, status, version and attention', () => {
    expect(filterSubmissions(SUBMISSIONS, { query: '0011' })).toHaveLength(1);
    expect(filterSubmissions(SUBMISSIONS, { status: 'IN_PROGRESS' })).toHaveLength(2);
    expect(filterSubmissions(SUBMISSIONS, { version: EMER })).toHaveLength(4);
    expect(filterSubmissions(SUBMISSIONS, { attentionOnly: true })).toHaveLength(3);
    expect(filterSubmissions(SUBMISSIONS, { status: 'IN_PROGRESS', version: EMER })).toHaveLength(1);
  });

  test('sorting and paging', () => {
    expect(sortSubmissions(SUBMISSIONS, 'santulanId', 'asc')[0].attemptId).toBe('a1');
    expect(sortSubmissions(SUBMISSIONS, 'qualityFlagCount', 'desc')[0].attemptId).toBe('a9');
    expect(sortSubmissions(SUBMISSIONS, 'submittedAt', 'desc')[0].attemptId).toBe('a12');
    const p = paginate(SUBMISSIONS, 2, 10);
    expect(p).toMatchObject({ page: 2, pages: 2, from: 11, to: 12, total: 12 });
    expect(p.rows).toHaveLength(2);
    expect(paginate(SUBMISSIONS, 99, 10).page).toBe(2); // clamped
    expect(paginate([], 1, 10)).toMatchObject({ pages: 1, from: 0, to: 0 });
  });

  test('CSV quotes fields and neutralises spreadsheet formulas', () => {
    const csv = submissionsToCsv([mk(1, { santulanId: '=HYPERLINK("x")', versionLabel: 'a,b' })]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('Santulan ID,Version,Status,Sessions,Quality flags,Submitted at,Completed at');
    expect(row.startsWith(`"'=HYPERLINK(""x"")",`)).toBe(true);
    expect(row).toContain('"a,b"');
  });
});

/* ------------------------------------------------------------------ components */
describe('BarChart', () => {
  const data = [
    { key: 'A', label: 'Report ready', count: 6, tone: 'success' },
    { key: 'B', label: 'Paused', count: 2, tone: 'warning' },
  ];

  test('labels each bar, shows the value, and a status bar carries an icon + label', () => {
    const { container } = render(<BarChart data={data} ariaLabel="By status" />);
    const list = screen.getByRole('list', { name: 'By status' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Report ready')).toBeInTheDocument();
    expect(within(list).getByText('6')).toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2); // status icons
  });

  test('table view is a real table with counts and shares', () => {
    render(<BarChart data={data} ariaLabel="By status" />);
    userEvent.click(screen.getByRole('button', { name: /view as table/i }));
    const table = screen.getByRole('table', { name: 'By status' });
    expect(within(table).getByRole('row', { name: /report ready 6 75%/i })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: /view as chart/i }));
    expect(screen.getByRole('list', { name: 'By status' })).toBeInTheDocument();
  });

  test('a bar is a keyboard-reachable button when selectable, and shows a tooltip on focus', () => {
    const onSelect = jest.fn();
    render(<BarChart data={data} ariaLabel="By status" onSelect={onSelect} />);
    const bar = screen.getByRole('button', { name: /report ready: 6 submissions, 75%/i });
    act(() => bar.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('6');
    userEvent.click(bar);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'A' }));
    act(() => bar.blur());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('is axe-clean in chart and table view', async () => {
    const { container } = render(<BarChart data={data} ariaLabel="By status" onSelect={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
    userEvent.click(screen.getByRole('button', { name: /view as table/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Modal', () => {
  test('is a labelled modal dialog: focus moves in, Escape closes, focus returns to the opener', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <>
        <button type="button">Opener</button>
        <Modal open={false} onClose={onClose} title="Confirm thing" description="Are you sure?">
          <button type="button">Inside</button>
        </Modal>
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Opener' });
    act(() => opener.focus());
    rerender(
      <>
        <button type="button">Opener</button>
        <Modal open onClose={onClose} title="Confirm thing" description="Are you sure?">
          <button type="button">Inside</button>
        </Modal>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm thing' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Are you sure?');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button">Opener</button>
        <Modal open={false} onClose={onClose} title="Confirm thing">
          <button type="button">Inside</button>
        </Modal>
      </>,
    );
    expect(document.activeElement).toBe(opener);
  });

  test('Tab wraps inside the dialog', () => {
    render(
      <Modal open onClose={() => {}} title="Trap">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>,
    );
    act(() => screen.getByRole('button', { name: 'Last' }).focus());
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  test('with two dialogs open, Escape closes only the top one', () => {
    const closeBottom = jest.fn();
    const closeTop = jest.fn();
    render(
      <>
        <Modal open onClose={closeBottom} title="Bottom">
          <p>b</p>
        </Modal>
        <Modal open onClose={closeTop} title="Top">
          <p>t</p>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ dashboard shell + overview */
describe('Admin shell and Overview', () => {
  test('sidebar lists the four areas, marks the current page, and shows who is signed in', async () => {
    renderAt('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Overview', 'Submissions', 'Item pools', 'Participation']);
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('Santulan Admin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('admin@santulan.local')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute('href', '#admin-main');
  });

  test('shows headline numbers and both charts from one fetch', async () => {
    renderAt('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    await screen.findByText('Total submissions');
    expect(tile('Total submissions')).toHaveTextContent('12');
    expect(tile('In progress')).toHaveTextContent('3');
    expect(tile('Completed')).toHaveTextContent('7');
    expect(tile('Completed')).toHaveTextContent('58% of submissions');
    expect(tile('Needs attention')).toHaveTextContent('3');
    expect(tile('Needs attention')).toHaveTextContent('3 quality flags');
    expect(screen.getByRole('list', { name: 'Submissions by status' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Submissions by item-pool version' })).toBeInTheDocument();
    expect(api.getSubmissions).toHaveBeenCalledTimes(1);
  });

  test('lists what needs attention and links through', async () => {
    renderAt('/admin');
    const panel = (await screen.findByRole('region', { name: 'Needs attention' }));
    expect(within(panel).getByText('STLN-0009')).toBeInTheDocument();
    expect(within(panel).getByText('STLN-0011')).toBeInTheDocument();
    expect(within(panel).getByText('2 flagged')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/admin/submissions?attention=1');
  });

  test('selecting a status bar opens Submissions already filtered', async () => {
    renderAt('/admin');
    const bar = await screen.findByRole('button', { name: /in progress: 2 submissions/i });
    userEvent.click(bar);
    expect(await screen.findByRole('heading', { level: 1, name: 'Submissions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('IN_PROGRESS');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(1 + 2); // header + 2 in-progress
  });

  test('a single item-pool version is stated as a fact, not drawn as a lone bar', async () => {
    api.getSubmissions.mockResolvedValueOnce({ submissions: SUBMISSIONS.filter((x) => x.versionLabel === ADOL) });
    renderAt('/admin');
    expect(await screen.findByText(/all/i, { selector: 'p' })).toHaveTextContent(`All 8 submissions used ${ADOL}.`);
    expect(screen.queryByRole('list', { name: 'Submissions by item-pool version' })).not.toBeInTheDocument();
  });

  test('empty, loading and error states', async () => {
    api.getSubmissions.mockResolvedValueOnce({ submissions: [] });
    const first = renderAt('/admin');
    expect(await screen.findByText(/no submissions yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /import an item pool/i })).toHaveAttribute('href', '/admin/item-pools');
    first.unmount();

    api.getSubmissions.mockRejectedValueOnce(new Error('boom'));
    renderAt('/admin');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load submissions: boom');
  });

  test('Refresh refetches', async () => {
    renderAt('/admin');
    await screen.findByText('Total submissions');
    userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.getSubmissions).toHaveBeenCalledTimes(2));
  });

  test('Sign out clears the session and goes to login', async () => {
    renderAt('/admin');
    await screen.findByText('Total submissions');
    userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(api.logout).toHaveBeenCalled();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  test('the overview is axe-clean', async () => {
    const { container } = renderAt('/admin');
    await screen.findByText('Total submissions');
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ------------------------------------------------------------------ submissions */
describe('Submissions', () => {
  const rowsOf = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

  test('pages through the list, newest first', async () => {
    renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    expect(rowsOf()).toHaveLength(10);
    expect(within(rowsOf()[0]).getByText('STLN-0012')).toBeInTheDocument(); // newest submitted first
    userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(await screen.findByText('Showing 11–12 of 12')).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(2);
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  test('search narrows the list and resets to page 1', async () => {
    renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), '0009');
    expect(await screen.findByText('Showing 1–1 of 1')).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(1);
  });

  test('status, version and needs-attention filters combine; clear restores the list', async () => {
    renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    userEvent.selectOptions(screen.getByLabelText('Item-pool version'), EMER);
    expect(await screen.findByText('Showing 1–4 of 4')).toBeInTheDocument();
    userEvent.click(screen.getByLabelText('Needs attention only'));
    expect(await screen.findByText('Showing 1–1 of 1')).toBeInTheDocument(); // only a9 is both emerging + flagged
    userEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
    expect(await screen.findByText('Showing 1–10 of 12')).toBeInTheDocument();
  });

  test('no matches shows an empty state with a way out', async () => {
    renderAt('/admin/submissions?status=EXPIRED');
    expect(await screen.findByText(/no submissions match these filters/i)).toBeInTheDocument();
    userEvent.click(screen.getAllByRole('button', { name: /clear filters/i }).pop());
    expect(await screen.findByText('Showing 1–10 of 12')).toBeInTheDocument();
  });

  test('columns sort and announce it', async () => {
    renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    const idHeader = screen.getByRole('columnheader', { name: /santulan id/i });
    expect(idHeader).toHaveAttribute('aria-sort', 'none');
    userEvent.click(within(idHeader).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /santulan id/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(rowsOf()[0]).getByText('STLN-0001')).toBeInTheDocument();
    userEvent.click(within(screen.getByRole('columnheader', { name: /santulan id/i })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /santulan id/i })).toHaveAttribute('aria-sort', 'descending');
  });

  test('exports the filtered rows as CSV', async () => {
    let blob;
    global.URL.createObjectURL = jest.fn((b) => {
      blob = b;
      return 'blob:test';
    });
    global.URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt('/admin/submissions?attention=1');
    await screen.findByText('Showing 1–3 of 3');
    userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsText(blob);
    });
    expect(text.split('\n')).toHaveLength(1 + 3);
  });

  test('a row opens a drawer with scores and flags; a flag is reviewed in a dialog', async () => {
    renderAt('/admin/submissions?attention=1');
    await screen.findByText('Showing 1–3 of 3');
    userEvent.click(screen.getByRole('button', { name: 'View submission STLN-0009' }));

    const drawer = await screen.findByRole('dialog', { name: 'Submission STLN-0009' });
    expect(await within(drawer).findByText('C1 · Body & Self-Regulation')).toBeInTheDocument();
    expect(within(drawer).getByText('Answered items').nextSibling).toHaveTextContent('3');
    expect(within(drawer).getByText('Needs review')).toBeInTheDocument();
    expect(within(drawer).getByText('Checked, fine')).toBeInTheDocument();

    userEvent.click(within(drawer).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review flag Q03' });
    const save = within(dialog).getByRole('button', { name: /save review/i });
    expect(save).toBeDisabled(); // a note is required
    await userEvent.type(within(dialog).getByLabelText('Disposition note'), 'Looks like a rushed session');
    userEvent.click(save);

    await waitFor(() => expect(api.reviewQualityFlag).toHaveBeenCalledWith('f1', 'Looks like a rushed session'));
    expect(await screen.findByText('Flag Q03 marked as reviewed.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review flag Q03' })).not.toBeInTheDocument());
    expect(api.getSubmissions).toHaveBeenCalledTimes(2); // list refreshed after the change
  });

  test('Escape closes only the review dialog, then the drawer', async () => {
    renderAt('/admin/submissions?attention=1');
    await screen.findByText('Showing 1–3 of 3');
    userEvent.click(screen.getByRole('button', { name: 'View submission STLN-0009' }));
    const drawer = await screen.findByRole('dialog', { name: 'Submission STLN-0009' });
    userEvent.click(await within(drawer).findByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog', { name: 'Review flag Q03' });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review flag Q03' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Submission STLN-0009' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('a failed detail load says so', async () => {
    api.getSubmissionDetail.mockRejectedValueOnce(new Error('Attempt not found'));
    renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    userEvent.click(screen.getByRole('button', { name: 'View submission STLN-0012' }));
    expect(await screen.findByText('Attempt not found')).toBeInTheDocument();
  });

  test('the page is axe-clean', async () => {
    const { container } = renderAt('/admin/submissions');
    await screen.findByText('Showing 1–10 of 12');
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ------------------------------------------------------------------ item pools */
describe('Item pools', () => {
  const xlsx = (name = 'pool.xlsx') => new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  test('a good import reports the version, item count and that it is active', async () => {
    api.importItemPool.mockResolvedValue({ import: { id: 'i1', status: 'accepted' }, version: { id: 'v1', versionLabel: ADOL, itemCount: 175, active: true, reimported: false } });
    renderAt('/admin/item-pools');
    userEvent.upload(await screen.findByLabelText(/drop an item pool/i), xlsx());

    expect(await screen.findByText('Import complete.')).toBeInTheDocument();
    expect(tile('Items')).toHaveTextContent('175');
    expect(tile('Active')).toHaveTextContent('Yes');
    expect(api.importItemPool).toHaveBeenCalledTimes(1);
    const history = screen.getByRole('table', { name: /imported in this session/i });
    expect(within(history).getByText('pool.xlsx')).toBeInTheDocument();
  });

  test('validation failures are listed by row, capped at 20 with a count of the rest', async () => {
    const errors = Array.from({ length: 30 }, (_, i) => ({ row: i + 2, column: 'keying', message: 'keying must be POSITIVE or REVERSE' }));
    api.importItemPool.mockRejectedValue(Object.assign(new Error('No valid rows found in the uploaded file'), { details: { errors } }));
    renderAt('/admin/item-pools');
    userEvent.upload(await screen.findByLabelText(/drop an item pool/i), xlsx());

    expect(await screen.findByText('No valid rows found in the uploaded file')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /rows that failed validation/i });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 20);
    expect(screen.getByText(/and 10 more rows/i)).toBeInTheDocument();
  });

  test('a file with no item_code column is recognised as the wrong kind of file', async () => {
    const errors = Array.from({ length: 5 }, (_, i) => ({ row: i + 2, column: 'item_code', message: 'item_code is required' }));
    api.importItemPool.mockRejectedValue(Object.assign(new Error('No valid rows found in the uploaded file'), { details: { errors } }));
    renderAt('/admin/item-pools');
    userEvent.upload(await screen.findByLabelText(/drop an item pool/i), xlsx('students.xlsx'));
    expect(await screen.findByText(/doesn't look like an item-pool workbook/i)).toBeInTheDocument();
  });

  test('rejects a non-.xlsx or oversized file without calling the API', async () => {
    renderAt('/admin/item-pools');
    const input = await screen.findByLabelText(/drop an item pool/i);
    fireEvent.change(input, { target: { files: [new File(['x'], 'pool.csv', { type: 'text/csv' })] } });
    expect(await screen.findByText('File must be an .xlsx workbook.')).toBeInTheDocument();

    const big = xlsx('big.xlsx');
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('File exceeds the 2 MB limit.')).toBeInTheDocument();
    expect(api.importItemPool).not.toHaveBeenCalled();
  });

  test('the page is axe-clean', async () => {
    const { container } = renderAt('/admin/item-pools');
    await screen.findByRole('heading', { level: 1, name: 'Item pools' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ------------------------------------------------------------------ participation */
describe('Participation', () => {
  test('Reopen is immediate and records the reason', async () => {
    renderAt('/admin/participation');
    await userEvent.type(await screen.findByLabelText(/reason \(optional\)/i), 'Term restarted');
    userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.controlParticipation).toHaveBeenCalledWith({ action: 'REOPEN', reason: 'Term restarted' }));
    expect(await screen.findByText(/participation reopened/i)).toBeInTheDocument();
    expect(screen.getByText(/Reopen recorded/)).toBeInTheDocument();
  });

  test('Pause and Stop need confirmation, and cancelling does nothing', async () => {
    renderAt('/admin/participation');
    userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop participation?' });
    userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.controlParticipation).not.toHaveBeenCalled();
  });

  test('confirming sends the action', async () => {
    renderAt('/admin/participation');
    userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pause participation?' });
    expect(dialog).toHaveAccessibleDescription(/no reason entered/i);
    userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.controlParticipation).toHaveBeenCalledWith({ action: 'PAUSE', reason: undefined }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/participation paused/i)).toBeInTheDocument();
  });

  test('a failure is reported and the dialog stays open', async () => {
    api.controlParticipation.mockRejectedValueOnce(new Error('Forbidden'));
    renderAt('/admin/participation');
    userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop participation?' });
    userEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(/could not record the action: forbidden/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Stop participation?' })).toBeInTheDocument();
  });

  test('says plainly that it only knows the last action from this browser', async () => {
    api.getLastControl.mockReturnValue({ action: 'PAUSE', reason: 'Exam week', at: '2026-09-18T08:00:00.000Z' });
    renderAt('/admin/participation');
    expect(await screen.findByText(/Pause recorded/)).toHaveTextContent('Exam week');
    expect(screen.getByText(/does not report the live participation state/i)).toBeInTheDocument();
  });

  test('the page is axe-clean', async () => {
    const { container } = renderAt('/admin/participation');
    await screen.findByRole('heading', { level: 1, name: 'Participation' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
