/*
 * CR-006-13: the adult self-consent action on the Privacy page, presented as a consent-form popup (opened from a "Review
 * consent form" prompt, not an always-visible checkbox). A minor never sees this particular popup; they get the CR-006-14
 * parent/guardian popup instead - see minorSelfService.test.js for that one in full.
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

const openPopup = async () => userEvent.click(await screen.findByRole('button', { name: 'Review consent form' }));

beforeEach(() => jest.clearAllMocks());

describe('adult: consent-form popup confirms self-consent', () => {
  test('with no consent on file yet, "Review consent form" appears instead of "No consent records yet"; the popup opens with Agree & Confirm disabled until ticked', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('button', { name: 'Review consent form' })).toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
    await openPopup();
    expect(await screen.findByRole('dialog', { name: 'Consent Form' })).toBeInTheDocument();
    expect(screen.getByText('I agree to take part in Santulan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agree & Confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Agree & Confirm' })).toBeEnabled();
  });

  test('ticking the box and confirming calls the one-shot self-consent endpoint, closes the popup and reloads', async () => {
    api.consentRequirements
      .mockResolvedValueOnce({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] })
      .mockResolvedValueOnce({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [{ consentId: 'c1', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', status: 'VERIFIED' }] });
    api.selfConsent.mockResolvedValue({ consentId: 'c1', status: 'VERIFIED' });
    renderPage(<PrivacyPage />);
    await openPopup();
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Agree & Confirm' }));
    await waitFor(() => expect(api.selfConsent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your consents')).toBeInTheDocument(); // the consents list now shows the verified record
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // popup closes once verified
    expect(screen.queryByRole('button', { name: 'Review consent form' })).not.toBeInTheDocument();
  });

  test('an already-verified adult sees no prompt at all, only the ordinary consent list', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [{ consentId: 'c1', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', status: 'VERIFIED' }] });
    renderPage(<PrivacyPage />);
    await screen.findByText('Your consents');
    expect(screen.queryByRole('button', { name: 'Review consent form' })).not.toBeInTheDocument();
    expect(api.selfConsent).not.toHaveBeenCalled();
  });

  test('a server refusal (e.g. no approved protocol) is shown, and the popup stays open so the participant can retry', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    api.selfConsent.mockRejectedValue(Object.assign(new Error('No approved protocol is configured for ADULT_SELF_CONSENT'), { code: 'PROTOCOL_UNAPPROVED' }));
    renderPage(<PrivacyPage />);
    await openPopup();
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Agree & Confirm' }));
    expect(await screen.findByText(/no approved protocol is configured/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Consent Form' })).toBeInTheDocument(); // still open to retry
  });

  test('Cancel closes the popup without calling the endpoint', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    await openPopup();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.selfConsent).not.toHaveBeenCalled();
  });

  test('is axe-clean with the popup open', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    const { container } = renderPage(<PrivacyPage />);
    await openPopup();
    await screen.findByRole('dialog');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('minor: never sees the ADULT self-consent popup (that one is adults only)', () => {
  test('a minor sees the "Parent / Guardian Consent" prompt, never the adult "Consent Form" one', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    await openPopup();
    expect(await screen.findByRole('dialog', { name: 'Parent / Guardian Consent' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Consent Form' })).not.toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
  });

  test('a minor\'s own pending assent still shows the ordinary "Give my consent" grant button too, alongside the consent prompt', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'PENDING' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'PENDING' }],
    });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('button', { name: 'Give my consent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review consent form' })).toBeInTheDocument();
  });
});
