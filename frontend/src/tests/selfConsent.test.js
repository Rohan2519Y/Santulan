/*
 * CR-006-13: the one-checkbox self-consent action on the Privacy page (adults only). A minor never sees this particular
 * checkbox; they get the CR-006-14 minor checkbox instead - see minorSelfService.test.js for that one in full.
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

beforeEach(() => jest.clearAllMocks());

describe('adult: one checkbox confirms self-consent', () => {
  test('with no consent on file yet, the checkbox appears instead of "No consent records yet", and Confirm is disabled until it is ticked', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    expect(await screen.findByText('I agree to take part in Santulan.')).toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm my consent' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm my consent' })).toBeEnabled();
  });

  test('ticking the box and confirming calls the one-shot self-consent endpoint and then reloads', async () => {
    api.consentRequirements
      .mockResolvedValueOnce({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] })
      .mockResolvedValueOnce({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [{ consentId: 'c1', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', status: 'VERIFIED' }] });
    api.selfConsent.mockResolvedValue({ consentId: 'c1', status: 'VERIFIED' });
    renderPage(<PrivacyPage />);
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm my consent' }));
    await waitFor(() => expect(api.selfConsent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your consents')).toBeInTheDocument(); // the consents list now shows the verified record
    expect(screen.queryByText('I agree to take part in Santulan.')).not.toBeInTheDocument(); // checkbox gone once verified
  });

  test('an already-verified adult sees no checkbox, only the ordinary consent list', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [{ consentId: 'c1', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', status: 'VERIFIED' }] });
    renderPage(<PrivacyPage />);
    await screen.findByText('Your consent');
    expect(screen.queryByText('I agree to take part in Santulan.')).not.toBeInTheDocument();
    expect(api.selfConsent).not.toHaveBeenCalled();
  });

  test('a server refusal (e.g. no approved protocol) is shown, and the checkbox stays so the participant can retry', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    api.selfConsent.mockRejectedValue(Object.assign(new Error('No approved protocol is configured for ADULT_SELF_CONSENT'), { code: 'PROTOCOL_UNAPPROVED' }));
    renderPage(<PrivacyPage />);
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm my consent' }));
    expect(await screen.findByText(/no approved protocol is configured/i)).toBeInTheDocument();
    expect(screen.getByText('I agree to take part in Santulan.')).toBeInTheDocument(); // still there to retry
  });

  test('is axe-clean with the checkbox showing', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    const { container } = renderPage(<PrivacyPage />);
    await screen.findByRole('checkbox');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('minor: never sees the ADULT self-consent checkbox (that one is adults only)', () => {
  test('a minor sees the minor checkbox (CR-006-14), never the adult "I agree to take part in Santulan." checkbox', async () => {
    api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    renderPage(<PrivacyPage />);
    expect(await screen.findByText('I agree to take part, and my parent or guardian has agreed to this too.')).toBeInTheDocument();
    expect(screen.queryByText('I agree to take part in Santulan.')).not.toBeInTheDocument();
    expect(screen.queryByText('No consent records yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm my consent' })).not.toBeInTheDocument();
  });

  test('a minor\'s own pending assent still shows the ordinary "Give my consent" grant button too, alongside the minor checkbox', async () => {
    api.consentRequirements.mockResolvedValue({
      isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
      consents: [{ consentId: 'a1', consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'PENDING' }, { consentId: 'p1', consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'PENDING' }],
    });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('button', { name: 'Give my consent' })).toBeInTheDocument();
    expect(screen.getByText('I agree to take part, and my parent or guardian has agreed to this too.')).toBeInTheDocument();
    expect(screen.queryByText('I agree to take part in Santulan.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm my consent' })).not.toBeInTheDocument();
  });
});
