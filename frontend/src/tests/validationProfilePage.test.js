import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import ValidationProfilePage from '../pages/participant/ValidationProfilePage';
import { api } from '../services/santulanApi';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { registrationState: jest.fn(), submitProfile: jest.fn(), ownProfile: jest.fn() },
}));

const STATE = (over = {}) => ({
  santulanId: 'STN-ABCDEFGHJKMNPQRSTVWX', participationRoute: 'OPEN', assessmentTrack: 'ADOLESCENT', isMinor: true,
  requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], attempt: null, profileCompleted: false, ...over,
});
const NOT_FOUND = { status: 404, message: 'not found' };
const PROFILE = (over = {}) => ({
  profileId: 'pr1', participantId: 'p1', profileVersion: 'STUDENT_PROFILE_v1.0',
  educationStage: null, currentClassYear: null, primaryLanguageMode: null, primaryLanguageDetail: null,
  mediumOfInstruction: null, mediumOfInstructionDetail: null, genderResearch: null, genderSelfDescription: null,
  broadRegionMode: null, broadRegionDetail: null, urbanicity: null, accessibilityAccommodation: null, accessibilityAccommodationDetail: null,
  ...over,
});

/** A router with real Dashboard/Profile stand-ins, so "navigate to /student" and "navigate to /student/profile" are observable. */
const renderIt = () => render(
  <MemoryRouter initialEntries={['/student/validation-profile']}>
    <Routes>
      <Route path="/student/validation-profile" element={<ValidationProfilePage />} />
      <Route path="/student" element={<p>Dashboard landed</p>} />
      <Route path="/student/profile" element={<p>Profile landed</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  jest.clearAllMocks();
  api.ownProfile.mockRejectedValue(NOT_FOUND); // first-time (no profile yet) unless a test overrides this
});

describe('validation profile page', () => {
  test('an existing profile pre-fills the form for editing, instead of skipping the page', async () => {
    api.registrationState.mockResolvedValue(STATE({ profileCompleted: true }));
    api.ownProfile.mockResolvedValue(PROFILE({ educationStage: 'SCHOOL', currentClassYear: 'GRADE_10' }));
    renderIt();
    expect(await screen.findByText('Your research profile')).toBeInTheDocument();
    expect(screen.getByLabelText('Current education stage')).toHaveValue('SCHOOL');
    expect(screen.getByLabelText('Current class / year')).toHaveValue('GRADE_10');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  test('editing an existing profile and saving navigates back to My profile, not the dashboard', async () => {
    api.registrationState.mockResolvedValue(STATE({ profileCompleted: true }));
    api.ownProfile.mockResolvedValue(PROFILE({ educationStage: 'SCHOOL' }));
    api.submitProfile.mockResolvedValue({ profileId: 'pr2' });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.submitProfile).toHaveBeenCalledWith({ educationStage: 'SCHOOL' }));
    expect(await screen.findByText('Profile landed')).toBeInTheDocument();
  });

  test('Cancel while editing leaves without calling the API and returns to My profile', async () => {
    api.registrationState.mockResolvedValue(STATE({ profileCompleted: true }));
    api.ownProfile.mockResolvedValue(PROFILE());
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(await screen.findByText('Profile landed')).toBeInTheDocument();
    expect(api.submitProfile).not.toHaveBeenCalled();
  });

  test('every question is optional: Skip for now leaves without calling the API', async () => {
    api.registrationState.mockResolvedValue(STATE());
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /skip for now/i }));
    expect(await screen.findByText('Dashboard landed')).toBeInTheDocument();
    expect(api.submitProfile).not.toHaveBeenCalled();
  });

  test('submits only the answered questions, and a class/year selector appears only after an education stage is chosen', async () => {
    api.registrationState.mockResolvedValue(STATE());
    api.submitProfile.mockResolvedValue({ profileId: 'pr1' });
    renderIt();
    await screen.findByText('Your studies');
    expect(screen.queryByLabelText('Current class / year')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Current education stage'), 'SCHOOL');
    await userEvent.selectOptions(await screen.findByLabelText('Current class / year'), 'GRADE_10');
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => expect(api.submitProfile).toHaveBeenCalledWith({ educationStage: 'SCHOOL', currentClassYear: 'GRADE_10' }));
    expect(await screen.findByText('Dashboard landed')).toBeInTheDocument();
  });

  test('a detail field appears only when its mode demands text, and is included in the submission', async () => {
    api.registrationState.mockResolvedValue(STATE());
    api.submitProfile.mockResolvedValue({ profileId: 'pr1' });
    renderIt();
    await screen.findByText('Language');
    expect(screen.queryByLabelText('Which language(s)?')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Primary / home language'), 'DIFFERENT');
    await userEvent.type(await screen.findByLabelText('Which language(s)?'), 'Marathi');
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => expect(api.submitProfile).toHaveBeenCalledWith({ primaryLanguageMode: 'DIFFERENT', primaryLanguageDetail: 'Marathi' }));
  });

  test('broad region and urbanicity are shown for OPEN participation but not for institutional', async () => {
    api.registrationState.mockResolvedValueOnce(STATE({ participationRoute: 'OPEN' }));
    renderIt();
    await screen.findByText('A few more questions');
    expect(screen.getByLabelText('Broad region (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Area (optional)')).toBeInTheDocument();
  });

  test('institutional participation hides broad region and urbanicity entirely', async () => {
    api.registrationState.mockResolvedValueOnce(STATE({ participationRoute: 'INSTITUTIONAL' }));
    renderIt();
    await screen.findByText('A few more questions');
    expect(screen.queryByLabelText('Broad region (optional)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Area (optional)')).not.toBeInTheDocument();
  });

  test('a submission failure shows the error and stays on the page', async () => {
    api.registrationState.mockResolvedValue(STATE());
    api.submitProfile.mockRejectedValue(new Error('offline'));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /save and continue/i }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard landed')).not.toBeInTheDocument();
  });

  test('is axe-clean', async () => {
    api.registrationState.mockResolvedValue(STATE());
    const { container } = renderIt();
    await screen.findByText('Your studies');
    expect(await axe(container)).toHaveNoViolations();
  });
});
