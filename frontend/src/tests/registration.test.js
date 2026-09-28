import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../pages/register/RegisterPage';
import { api } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { requestOtp: jest.fn(), verifyOtp: jest.fn(), routeAge: jest.fn(), declareAge: jest.fn() },
}));

const fakeToken = () => `h.${btoa(JSON.stringify({ role: 'participant', participantId: 'p1', exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;

async function toAgeStep() {
  api.requestOtp.mockResolvedValue({ sent: true });
  api.verifyOtp.mockResolvedValue({ registered: false, registrationToken: 'reg-token' });
  renderPage(<RegisterPage />);
  await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.test');
  await userEvent.click(screen.getByLabelText('I am 13 years or older'));
  await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
  const boxes = await screen.findAllByLabelText(/digit \d of 6/i);
  for (let i = 0; i < 6; i += 1) await userEvent.type(boxes[i], String(i + 1));
  await userEvent.click(screen.getByRole('button', { name: /verify and continue/i }));
  await screen.findByLabelText('Age in years');
}

beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

describe('registration wizard (T116)', () => {
  test('step 1 shows "Step 1 of 5", an email/mobile choice and the 13-or-older confirmation', () => {
    renderPage(<RegisterPage />);
    expect(screen.getByLabelText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Email Address' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mobile Number' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /registered through a school or college/i })).toHaveAttribute('href', '/login');
  });

  test('step 1 refuses to continue until the 13-or-older box is ticked', async () => {
    renderPage(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Email address'), 'a@b.test');
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    expect(await screen.findByText(/confirm that you are 13 years or older/i)).toBeInTheDocument();
    expect(api.requestOtp).not.toHaveBeenCalled();
  });

  test('the OTP step has six labelled boxes, a resend countdown and paste-fill', async () => {
    api.requestOtp.mockResolvedValue({ sent: true });
    renderPage(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Email address'), 'a@b.test');
    await userEvent.click(screen.getByLabelText('I am 13 years or older'));
    await userEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    const boxes = await screen.findAllByLabelText(/digit \d of 6/i);
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByRole('button', { name: /resend code in \d+s/i })).toBeDisabled();
    fireEvent.paste(boxes[0], { clipboardData: { getData: () => '123456' } });
    expect(boxes.map((b) => b.value).join('')).toBe('123456');
  });

  test('the age step is a numeric "Age in years" field with NO date-of-birth input', async () => {
    await toAgeStep();
    const age = screen.getByLabelText('Age in years');
    expect(age).toHaveAttribute('type', 'number');
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/date of birth|DD\/MM/i);
  });

  test.each(['12', '26'])('age %s shows the calm ineligible message and creates nothing', async (value) => {
    await toAgeStep();
    await userEvent.type(screen.getByLabelText('Age in years'), value);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/aged 13 to 25/i)).toBeInTheDocument();
    expect(api.routeAge).not.toHaveBeenCalled();
    expect(api.declareAge).not.toHaveBeenCalled();
  });

  test('the consent step states what the already-entered age derives - it never asks the participant to choose again', async () => {
    api.routeAge.mockResolvedValue({ eligible: true, assessmentTrack: 'ADOLESCENT', isMinor: true, requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
    await toAgeStep();
    await userEvent.type(screen.getByLabelText('Age in years'), '15');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Below 18 years')).toBeInTheDocument();
    expect(screen.getByText('Parent or guardian consent')).toBeInTheDocument();
    expect(screen.getByText('Your assent')).toBeInTheDocument();
    // no re-selection: neither the old choice cards nor any radiogroup exist any more
    expect(screen.queryByText('18 years or older')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  test('an adult participant sees only the adult card, never the minor one', async () => {
    api.routeAge.mockResolvedValue({ eligible: true, assessmentTrack: 'EMERGING_ADULT', isMinor: false, requiredConsents: ['ADULT_SELF_CONSENT'] });
    await toAgeStep();
    await userEvent.type(screen.getByLabelText('Age in years'), '20');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('18 years or older')).toBeInTheDocument();
    expect(screen.getByText('Your consent')).toBeInTheDocument();
    expect(screen.queryByText('Below 18 years')).not.toBeInTheDocument();
  });

  test('the success step shows the Santulan ID with Copy and, for a minor, waits for consent with Start disabled; a retry reuses the same idempotency key', async () => {
    api.routeAge.mockResolvedValue({ eligible: true, assessmentTrack: 'ADOLESCENT', isMinor: true, requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
    api.declareAge
      .mockRejectedValueOnce(Object.assign(new Error('We could not reach the server.'), { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ santulanId: 'STN-ABCDEFGHJKMNPQRSTVWX', isMinor: true, accessToken: fakeToken() });
    await toAgeStep();
    await userEvent.type(screen.getByLabelText('Age in years'), '15');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    // the parent/guardian consent form must be read before "Create my account" is enabled (student assent has no form to read)
    await userEvent.click(await screen.findByRole('button', { name: /read consent form/i }));
    await userEvent.click(await screen.findByRole('button', { name: /agree & approve/i }));
    await userEvent.click(await screen.findByRole('button', { name: /create my account/i }));
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create my account/i }));

    expect(await screen.findByText('STN-ABCDEFGHJKMNPQRSTVWX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText(/waiting for consent to be verified/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start assessment/i })).toBeDisabled();
    await waitFor(() => expect(api.declareAge).toHaveBeenCalledTimes(2));
    expect(api.declareAge.mock.calls[0][2]).toBe(api.declareAge.mock.calls[1][2]);            // one key per registration attempt
    expect(api.declareAge.mock.calls[0][1]).toBe(15);                                            // the age is the only personal value sent
  }, 15000); // two full round trips (a failed attempt, then a retry) can miss the 5s default under CI load
});
