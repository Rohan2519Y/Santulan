import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import PilotStudyDetailsPage from '../pages/participant/PilotStudyDetailsPage';
import { api } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { ownPilotDetails: jest.fn(), submitPilotDetails: jest.fn() },
}));

const NOT_FOUND = { status: 404, message: 'not found' };
const DETAILS = (over = {}) => ({
  detailsId: 'd1', participantId: 'p1', captureVersion: 'PILOT_STUDY_DETAILS_v1.0', fullName: 'A. Sharma',
  dateOfBirth: null, className: null, gender: null, birthOrder: null, siblingCount: null, religion: null,
  familyType: null, residenceType: null, state: null, schoolType: null, studyMedium: null, board: null, academicStream: null,
  ...over,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('pilot study details page', () => {
  test('starts blank when nothing has been submitted yet', async () => {
    api.ownPilotDetails.mockRejectedValue(NOT_FOUND);
    renderPage(<PilotStudyDetailsPage />);
    await screen.findByText('Identification');
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('pre-fills the form with an existing submission', async () => {
    api.ownPilotDetails.mockResolvedValue(DETAILS({ className: 'Grade 10', religion: 'HINDU' }));
    renderPage(<PilotStudyDetailsPage />);
    await screen.findByText('Identification');
    expect(screen.getByLabelText('Full name')).toHaveValue('A. Sharma');
    expect(screen.getByLabelText('Class')).toHaveValue('Grade 10');
    expect(screen.getByLabelText('Religion')).toHaveValue('HINDU');
  });

  test('the Save button is disabled until a full name is entered, then submits only the answered fields', async () => {
    api.ownPilotDetails.mockRejectedValue(NOT_FOUND);
    api.submitPilotDetails.mockResolvedValue(DETAILS());
    renderPage(<PilotStudyDetailsPage />);
    await screen.findByText('Identification');
    await userEvent.type(screen.getByLabelText('Full name'), 'A. Sharma');
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.submitPilotDetails).toHaveBeenCalledWith({ fullName: 'A. Sharma' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  test('a save failure shows the error and stays on the page', async () => {
    api.ownPilotDetails.mockRejectedValue(NOT_FOUND);
    api.submitPilotDetails.mockRejectedValue(new Error('offline'));
    renderPage(<PilotStudyDetailsPage />);
    await userEvent.type(await screen.findByLabelText('Full name'), 'A. Sharma');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('is axe-clean', async () => {
    api.ownPilotDetails.mockRejectedValue(NOT_FOUND);
    const { container } = renderPage(<PilotStudyDetailsPage />);
    await screen.findByText('Identification');
    expect(await axe(container)).toHaveNoViolations();
  });
});
