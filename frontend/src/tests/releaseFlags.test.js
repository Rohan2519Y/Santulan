/*
 * Release switches page (T132): the four switches with their server value, last change and a required-reason dialog. State is the
 * server's only: nothing changes locally, the page reloads after a successful change, and a refused change shows the server's message.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import ReleaseFlagsPage from '../pages/admin/ReleaseFlagsPage';
import { ToastProvider } from '../components/Toast/Toast';
import { releaseFlagApi, ApiError } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  releaseFlagApi: { list: jest.fn(), set: jest.fn() },
}));

const flags = (over = {}) => ({
  pilotS2: { value: false, changedAt: null, changedBy: null, reason: null },
  advancedEvidence: { value: false, changedAt: null, changedBy: null, reason: null },
  developmentRelease: { value: false, changedAt: null, changedBy: null, reason: null },
  pathwayRelease: { value: false, changedAt: null, changedBy: null, reason: null },
  ...over,
});
const renderIt = () => renderPage(<ToastProvider><ReleaseFlagsPage /></ToastProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  releaseFlagApi.list.mockResolvedValue(flags());
  releaseFlagApi.set.mockResolvedValue({ flag: 'pilotS2', value: true });
});

test('lists the four switches, all off with no change history, from the server', async () => {
  renderIt();
  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(4);
  expect(items.map((li) => within(li).getByText(/^(On|Off)$/).textContent)).toEqual(['Off', 'Off', 'Off', 'Off']);
  expect(screen.getAllByText('Never changed (default off)')).toHaveLength(4);
  for (const name of ['Pilot S2 scoring', 'Advanced evidence states', 'Development release', 'Pathway release']) expect(screen.getByText(name)).toBeInTheDocument();
});

test('shows a switch that is on with its last change and reason', async () => {
  releaseFlagApi.list.mockResolvedValue(flags({ pilotS2: { value: true, changedAt: '2026-09-20T10:00:00.000Z', changedBy: 'x', reason: 'Pilot week one approved' } }));
  renderIt();
  expect(await screen.findByText(/Pilot week one approved/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Turn off Pilot S2 scoring' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Turn on Development release' })).toBeInTheDocument();
});

test('a change needs a reason of at least 3 characters, sends the reason, then reloads the server state', async () => {
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'Turn on Pilot S2 scoring' }));
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Turn on' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Reason/), 'ab');
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Reason/), 'c');
  expect(confirm).toBeEnabled();
  releaseFlagApi.list.mockResolvedValue(flags({ pilotS2: { value: true, changedAt: '2026-09-20T10:00:00.000Z', changedBy: 'x', reason: 'abc' } }));
  await userEvent.click(confirm);
  await waitFor(() => expect(releaseFlagApi.set).toHaveBeenCalledWith('pilotS2', true, 'abc'));
  expect(await screen.findByRole('button', { name: 'Turn off Pilot S2 scoring' })).toBeInTheDocument(); // the value comes from the reload, not a local toggle
  expect(releaseFlagApi.list).toHaveBeenCalledTimes(2);
});

test('cancelling changes nothing and does not call the server', async () => {
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'Turn on Development release' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(releaseFlagApi.set).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a change the server refuses shows its message and leaves the switch as the server holds it', async () => {
  releaseFlagApi.set.mockRejectedValue(new ApiError('Only a Super Admin can change a release switch.', { status: 403, code: 'FORBIDDEN' }));
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'Turn on Pathway release' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Trying it');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
  expect(await within(dialog).findByText('Only a Super Admin can change a release switch.')).toBeInTheDocument();
  expect(releaseFlagApi.list).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Turn on Pathway release' })).toBeInTheDocument();
});

test('a failed load shows the error and no switches', async () => {
  releaseFlagApi.list.mockRejectedValue(new ApiError('We could not reach the server.', { code: 'NETWORK_ERROR' }));
  renderIt();
  expect(await screen.findByText('We could not reach the server.')).toBeInTheDocument();
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
});

test('the page has no accessibility violations', async () => {
  const { container } = renderIt();
  await screen.findAllByRole('listitem');
  expect(await axe(container)).toHaveNoViolations();
});
