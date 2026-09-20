/*
 * G9 / SC-008 / SC-011 — renders every participant screen with fixtures and fails on prohibited claims: validation or
 * diagnosis language, percentiles or norms, Low/Average/High as a band, "improved", any date-of-birth input or wording, and
 * a Santulan ID in the sample's semantic STU0000 style (real IDs are opaque).
 */
import { screen } from '@testing-library/react';
import { HomePage, AboutPage, GetStartedPage, SupportPage } from '../pages/public/PublicPages';
import RegisterPage from '../pages/register/RegisterPage';
import LoginPage from '../pages/LoginPage';
import DashboardPage from '../pages/participant/DashboardPage';
import AssessmentPage from '../pages/participant/AssessmentPage';
import { AssessmentCompletePage, GeneratingReportPage } from '../pages/participant/AfterSubmitPages';
import ResultsPage from '../pages/participant/ResultsPage';
import { ProfilePage, PrivacyPage, PreferencesPage, ThanksPage } from '../pages/participant/AccountPages';
import { api } from '../services/santulanApi';
import { renderPage, pageText } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: {
    routeAge: jest.fn(), requestOtp: jest.fn(), verifyOtp: jest.fn(), declareAge: jest.fn(), login: jest.fn(), setPassword: jest.fn(),
    registrationState: jest.fn(), consentGate: jest.fn(), consentRequirements: jest.fn(), attempt: jest.fn(), items: jest.fn(),
    responses: jest.fn(), resume: jest.fn(), scores: jest.fn(), saveResponse: jest.fn(), pause: jest.fn(), submit: jest.fn(),
    grantConsent: jest.fn(), withdrawConsent: jest.fn(), createAttempt: jest.fn(),
  },
}));

const PROHIBITED = [
  [/\bvalidated\b/i, 'validated'], [/\bdiagnos\w*/i, 'diagnosis'], [/\bclinical(ly)?\b/i, 'clinical'], [/\bpercentiles?\b/i, 'percentile'],
  [/\bnorms?\b|\bnorm-referenced\b|\bnormative\b/i, 'norm'], [/\b(low|average|high)\b\s*(band|level|range)?/i, 'Low/Average/High'],
  [/\bimproved\b|\bimprovement\b/i, 'improved'], [/date of birth|\bDOB\b|DD\/MM\/YYYY/i, 'date of birth'], [/\bSTU\d{4}\b/, 'semantic ID'],
  [/\b(reliable|proven|scientifically)\b/i, 'strength claim'], [/personalised insights?|personalized insights?/i, 'insight promise'],
];

const attemptModel = (status) => ({ attemptId: 'a1', status, session: { n: 2, of: 4 }, progress: { completed: 3, total: 3, percent: 100 }, lastSavedAt: '2026-09-20T10:00:00Z', canContinue: true });

beforeEach(() => {
  jest.clearAllMocks();
  api.registrationState.mockResolvedValue({ santulanId: 'STN-ABCDEFGHJKMNPQRSTVWX', participationRoute: 'OPEN', assessmentTrack: 'ADOLESCENT', isMinor: true, attempt: { attemptId: 'a1', status: 'IN_PROGRESS' } });
  api.consentGate.mockResolvedValue({ open: true, missingTypes: [] });
  api.attempt.mockResolvedValue(attemptModel('IN_PROGRESS'));
  api.consentRequirements.mockResolvedValue({ isMinor: true, requiredTypes: [], consents: [
    { consentId: 'c1', consentType: 'STUDENT_ASSENT', status: 'PENDING', giverRelationship: 'SELF' },
    { consentId: 'c2', consentType: 'PARENT_GUARDIAN_CONSENT', status: 'VERIFIED', giverRelationship: 'PARENT' },
  ] });
  api.items.mockResolvedValue({ scale: { points: 5, anchors: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' } }, items: [
    { itemId: 'i1', order: 1, domainCode: 'C1', text: 'I notice when my body feels tense.' }, { itemId: 'i2', order: 2, domainCode: 'C2', text: 'I can name how I feel.' },
  ] });
  api.responses.mockResolvedValue({ responses: [{ itemId: 'i1', value: '3', version: 1 }] });
  api.scores.mockResolvedValue({ scores: [
    { domainCode: 'C1', score: 4.25, completeness: 1, evidenceState: 'S2' }, { domainCode: 'C2', score: null, completeness: 0.5, evidenceState: 'S2' },
  ] });
});

const SCREENS = [
  ['Home', () => <HomePage />, null],
  ['About', () => <AboutPage />, null],
  ['Get started', () => <GetStartedPage />, null],
  ['Support', () => <SupportPage />, null],
  ['Register', () => <RegisterPage />, null],
  ['Sign in', () => <LoginPage />, null],
  ['Dashboard', () => <DashboardPage />, /Your journey matters/],
  ['Assessment hub', () => <AssessmentPage />, /Your assessment/],
  ['Assessment complete', () => <AssessmentCompletePage />, /Thank you/],
  ['Generating', () => <GeneratingReportPage pollMs={1000} />, /Your report/],
  ['Results', () => <ResultsPage />, /Your results/],
  ['Profile', () => <ProfilePage />, /My profile/],
  ['Privacy', () => <PrivacyPage />, /Privacy and consent/],
  ['Preferences', () => <PreferencesPage />, /Preferences/],
  ['Thanks', () => <ThanksPage />, /Thank you/],
];

describe('prohibited-claims scan (T118)', () => {
  test.each(SCREENS)('%s contains no prohibited claim, date-of-birth input or semantic ID', async (name, render, ready) => {
    const { container } = renderPage(render());
    if (ready) expect((await screen.findAllByText(ready)).length).toBeGreaterThan(0);
    const text = pageText(container);
    for (const [pattern, label] of PROHIBITED) expect({ label, hit: (text.match(pattern) || [])[0] || null }).toEqual({ label, hit: null });
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  test('the released results view shows real values and "Not enough data" for a null domain, and passes the same scan', async () => {
    api.registrationState.mockResolvedValue({ santulanId: 'STN-ABCDEFGHJKMNPQRSTVWX', participationRoute: 'OPEN', assessmentTrack: 'ADOLESCENT', isMinor: false, attempt: { attemptId: 'a1', status: 'REPORT_READY' } });
    api.attempt.mockResolvedValue(attemptModel('REPORT_READY'));
    const { container } = renderPage(<ResultsPage />);
    await screen.findByText(/on a scale from 1.00 to 5.00/);
    const text = pageText(container);
    expect(text).toMatch(/4.25/);
    expect(text).toMatch(/Not enough data/);
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    for (const [pattern, label] of PROHIBITED) expect({ label, hit: (text.match(pattern) || [])[0] || null }).toEqual({ label, hit: null });
  });

  test('a held or invalid attempt shows only the neutral message on the results screen', async () => {
    api.registrationState.mockResolvedValue({ attempt: { attemptId: 'a1', status: 'QUALITY_HOLD' } });
    api.attempt.mockResolvedValue(attemptModel('QUALITY_HOLD'));
    renderPage(<ResultsPage />);
    expect(await screen.findByText('Your responses are being reviewed.')).toBeInTheDocument();
    expect(api.scores).not.toHaveBeenCalled();
  });
});
