/*
 * CR-006-14: the one-checkbox minor self-service action on the Privacy page. A minor confirms their own STUDENT_ASSENT and
 * attests PARENT_GUARDIAN_CONSENT on their parent/guardian's behalf in one call, on their own device - a temporary stand-in
 * until a real parent/guardian portal exists. An adult never sees this checkbox; see selfConsent.test.js for their own.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { PrivacyPage } from '../pages/participant/AccountPages';
import { api } from '../services/santulanApi';
import { renderPage } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { consentRequirements: jest.fn(), selfConsent: jest.fn(), minorSelfService: jest.fn(), grantConsent: jest.fn(), withdrawConsent: jest.fn() },
}));

const CHECK_TEXT = 'I agree to take part, and my parent or guardian has agreed to this too.';

beforeEach(() => jest.clearAllMocks());

describe('minor: one checkbox confirms both required consents', () => {
  test('with nothing on file yet, the checkbox appears instead of "No consent records yet", and Confirm is disabled until it is ticked', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    expect(await screen.findByText(CHECK_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  test('ticking the box and confirming calls the minor-self-service endpoint once and then reloads', async () => {
    api.consentRequirements
      .mockResolvedValueOnce({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] })
      .mockResolvedValueOnce({
        isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
        consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'VERIFIED' }],
      });
    api.minorSelfService.mockResolvedValue({ assent: { consentId: 'a1', status: 'VERIFIED' }, parentGuardianConsent: { consentId: 'p1', status: 'VERIFIED' } });
    renderPage(<PrivacyPage />);
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.minorSelfService).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your consents')).toBeInTheDocument(); // the consents list now shows both verified records
    expect(screen.queryByText(CHECK_TEXT)).not.toBeInTheDocument(); // checkbox gone once both are verified
  });

  test('once verified, a minor sees only the ordinary consent list, no checkbox', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'VERIFIED' }],
    });
    renderPage(<PrivacyPage />);
    await screen.findByText('Your consents');
    expect(screen.queryByText(CHECK_TEXT)).not.toBeInTheDocument();
    expect(api.minorSelfService).not.toHaveBeenCalled();
  });

  test('only one of the two is verified so far - the checkbox still shows (confirming again is a safe no-op for the finished one)', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'PENDING' }],
    });
    renderPage(<PrivacyPage />);
    expect(await screen.findByText(CHECK_TEXT)).toBeInTheDocument();
  });

  test('a server refusal is shown, and the checkbox stays so the participant can retry', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    api.minorSelfService.mockRejectedValue(Object.assign(new Error('No approved protocol is configured for PARENT_GUARDIAN_CONSENT'), { code: 'PROTOCOL_UNAPPROVED' }));
    renderPage(<PrivacyPage />);
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/no approved protocol is configured/i)).toBeInTheDocument();
    expect(screen.getByText(CHECK_TEXT)).toBeInTheDocument(); // still there to retry
  });

  test('is axe-clean with the checkbox showing', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    const { container } = renderPage(<PrivacyPage />);
    await screen.findByRole('checkbox');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('adult: never sees the minor checkbox', () => {
  test('an adult with nothing on file sees only their own self-consent checkbox, never the minor one', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    await screen.findByText('I agree to take part in Santulan.');
    expect(screen.queryByText(CHECK_TEXT)).not.toBeInTheDocument();
    expect(api.minorSelfService).not.toHaveBeenCalled();
  });
});
