/*
 * CR-006-14: the minor self-service action on the Privacy page, presented as a "Parent / Guardian Consent" popup (opened from
 * a "Review consent form" prompt). A minor confirms their own STUDENT_ASSENT and attests PARENT_GUARDIAN_CONSENT on their
 * parent/guardian's behalf in one call, on their own device - a temporary stand-in until a real parent/guardian portal
 * exists. An adult never sees this popup; see selfConsent.test.js for their own.
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
const openPopup = async () => userEvent.click(await screen.findByRole('button', { name: 'Review consent form' }));

beforeEach(() => jest.clearAllMocks());

describe('minor: consent-form popup confirms both required consents', () => {
  test('with nothing on file yet, "Review consent form" appears instead of "No consent records yet"; the popup opens with Agree & Confirm disabled until ticked', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('button', { name: 'Review consent form' })).toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
    await openPopup();
    expect(await screen.findByRole('dialog', { name: 'Parent / Guardian Consent' })).toBeInTheDocument();
    expect(screen.getByText(CHECK_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agree & Confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Agree & Confirm' })).toBeEnabled();
  });

  test('ticking the box and confirming calls the minor-self-service endpoint once, closes the popup and reloads', async () => {
    api.consentRequirements
      .mockResolvedValueOnce({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] })
      .mockResolvedValueOnce({
        isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
        consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'VERIFIED' }],
      });
    api.minorSelfService.mockResolvedValue({ assent: { consentId: 'a1', status: 'VERIFIED' }, parentGuardianConsent: { consentId: 'p1', status: 'VERIFIED' } });
    renderPage(<PrivacyPage />);
    await openPopup();
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Agree & Confirm' }));
    await waitFor(() => expect(api.minorSelfService).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your consents')).toBeInTheDocument(); // the consents list now shows both verified records
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // popup closes once both are verified
  });

  test('once verified, a minor sees only the ordinary consent list, no prompt', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'VERIFIED' }],
    });
    renderPage(<PrivacyPage />);
    await screen.findByText('Your consents');
    expect(screen.queryByRole('button', { name: 'Review consent form' })).not.toBeInTheDocument();
    expect(api.minorSelfService).not.toHaveBeenCalled();
  });

  test('only one of the two is verified so far - the prompt still shows (confirming again is a safe no-op for the finished one)', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'PENDING' }],
    });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('button', { name: 'Review consent form' })).toBeInTheDocument();
  });

  test('a server refusal is shown, and the popup stays open so the participant can retry', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    api.minorSelfService.mockRejectedValue(Object.assign(new Error('No approved protocol is configured for PARENT_GUARDIAN_CONSENT'), { code: 'PROTOCOL_UNAPPROVED' }));
    renderPage(<PrivacyPage />);
    await openPopup();
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Agree & Confirm' }));
    expect(await screen.findByText(/no approved protocol is configured/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent / Guardian Consent' })).toBeInTheDocument(); // still open to retry
  });

  test('is axe-clean with the popup open', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    const { container } = renderPage(<PrivacyPage />);
    await openPopup();
    await screen.findByRole('dialog');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('adult: never sees the minor consent popup', () => {
  test('an adult with nothing on file sees only their own "Consent Form" popup, never "Parent / Guardian Consent"', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    await openPopup();
    expect(await screen.findByRole('dialog', { name: 'Consent Form' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Parent / Guardian Consent' })).not.toBeInTheDocument();
    expect(api.minorSelfService).not.toHaveBeenCalled();
  });
});
