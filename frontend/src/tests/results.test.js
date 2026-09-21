/*
 * Results page (T131): the seven-axis chart is drawn from the released report's PROFILE section; only PLOTTED domains carry a point;
 * NOT_ENOUGH_DATA reads "Not enough data yet" and is never plotted at 1.00; the withdrawn score endpoint is never called.
 */
import { screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import ResultsPage, { profileOf, toAxes } from '../pages/participant/ResultsPage';
import { api } from '../services/santulanApi';
import { renderPage, pageText } from './testUtils';

jest.mock('../services/santulanApi', () => ({
  ...jest.requireActual('../services/santulanApi'),
  api: { registrationState: jest.fn(), attempt: jest.fn(), report: jest.fn() },
}));

const CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const NAMES = { C1: 'Body & Self-Regulation', C2: 'Emotional Capability', C3: 'Relational & Social Capability', C4: 'Identity & Self-Concept', C5: 'Values, Purpose & Future Agency', C6: 'Adaptability & Resilience', C7: 'Self-Directed Learning & Executive Capability' };
const plotted = (code, score, over = {}) => ({ code, name: NAMES[code], display: 'PLOTTED', score, completeness: 0.9, completenessStatus: 'COMPLETE_WITH_MISSING', ...over });
const empty = (code) => ({ code, name: NAMES[code], display: 'NOT_ENOUGH_DATA', score: null, completeness: null, completenessStatus: null, message: 'Not enough data yet' });
const profile = (domains) => ({ scale: { min: 1, max: 5 }, context: { questionSet: 's', revision: 1, developmentalBand: 'D2', assessedOn: '2026-09-20' }, domains });
const report = (domains, extra = []) => ({ reportId: 'r1', state: 'REPORT_READY', sections: [{ type: 'PROFILE', locale: 'en', contentVersion: 'profile-v1', order: 1, content: JSON.stringify(profile(domains)) }, ...extra] });
const model = (over = {}) => ({ attemptId: 'a1', status: 'REPORT_READY', reportId: 'r1', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  api.registrationState.mockResolvedValue({ attempt: { attemptId: 'a1', status: 'REPORT_READY' } });
  api.attempt.mockResolvedValue(model());
});

describe('mapping the PROFILE payload', () => {
  test('profileOf reads the PROFILE section and returns null for a missing or unreadable one', () => {
    expect(profileOf(report(CODES.map(empty))).domains).toHaveLength(7);
    expect(profileOf({ sections: [] })).toBeNull();
    expect(profileOf({ sections: [{ type: 'PROFILE', content: '{not json' }] })).toBeNull();
    expect(profileOf({ sections: [{ type: 'PROFILE', content: '{"domains":"x"}' }] })).toBeNull();
    expect(profileOf(null)).toBeNull();
  });

  test('axes: exactly the seven domains in order; only PLOTTED ones have a score; an unplotted one is never given 1.00', () => {
    const axes = toAxes(profile(CODES.map((c) => (c === 'C2' ? plotted(c, 3.5) : empty(c)))));
    expect(axes.map((a) => a.code)).toEqual(CODES);
    expect(axes.find((a) => a.code === 'C2')).toMatchObject({ score: 3.5, note: '90% answered · Complete, a few answers skipped' });
    for (const a of axes.filter((x) => x.code !== 'C2')) expect(a).toMatchObject({ score: null, message: 'Not enough data yet' });
    expect(axes.some((a) => a.score === 1)).toBe(false);
  });
});

describe('the page', () => {
  test('draws the chart from the report, shows each plotted domain\'s score, completeness and status, and "Not enough data yet" for the rest; no score request', async () => {
    api.report.mockResolvedValue(report(CODES.map((c) => (c === 'C1' ? plotted(c, 4.25) : empty(c))), [
      { type: 'MEANING', domain: 'C1', locale: 'en', contentVersion: 'v1', order: 2, content: 'Approved meaning wording for this area.' },
    ]));
    const { container } = renderPage(<ResultsPage />);
    expect(await screen.findByText(/on a scale from 1.00 to 5.00/)).toBeInTheDocument();
    expect(api.report).toHaveBeenCalledWith('r1');
    const text = pageText(container);
    expect(text).toContain('4.25');
    expect(text).toContain('90% answered');
    expect((text.match(/Not enough data yet/g) || []).length).toBe(6);
    expect(text).toContain('Approved meaning wording for this area.');
    expect(container.querySelectorAll('svg[role="img"] circle')).toHaveLength(1); // one plotted point, none for the unplotted domains
    expect(container.querySelectorAll('svg[role="img"] text')).toHaveLength(7); // seven axis labels
    expect(text).not.toMatch(/percentile|benchmark|average|norm/i);
  });

  test('all seven NOT_ENOUGH_DATA: nothing is plotted and every axis says so', async () => {
    api.report.mockResolvedValue(report(CODES.map(empty)));
    const { container } = renderPage(<ResultsPage />);
    await screen.findByText(/on a scale from 1.00 to 5.00/);
    expect(container.querySelectorAll('svg[role="img"] circle')).toHaveLength(0);
    expect(container.querySelector('svg[role="img"] polygon[fill="var(--c-selected)"]')).toBeNull();
    expect((pageText(container).match(/Not enough data yet/g) || []).length).toBe(7);
  });

  test('a report that is not visible yet (no report id) shows a calm not-ready card and asks for nothing', async () => {
    api.attempt.mockResolvedValue(model({ status: 'SCORED', reportId: null }));
    renderPage(<ResultsPage />);
    expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
    expect(api.report).not.toHaveBeenCalled();
  });

  test('T11 / T12 reports show only the fixed neutral copy', async () => {
    api.report.mockResolvedValue({ reportId: 'r1', state: 'UNDER_REVIEW', sections: [{ type: 'UNDER_REVIEW', order: 1, content: 'Your responses are being reviewed.' }] });
    renderPage(<ResultsPage />);
    expect(await screen.findByText('Your responses are being reviewed.')).toBeInTheDocument();
  });

  test('a report the server cannot show (404 REPORT_NOT_READY) is reported calmly, not as a crash', async () => {
    api.report.mockRejectedValue(Object.assign(new Error('The report is not available yet'), { status: 404, code: 'REPORT_NOT_READY' }));
    renderPage(<ResultsPage />);
    expect(await screen.findByText('The report is not available yet')).toBeInTheDocument();
  });

  test('the page has no accessibility violations', async () => {
    api.report.mockResolvedValue(report(CODES.map((c) => (c === 'C1' ? plotted(c, 4.25) : empty(c)))));
    const { container } = renderPage(<ResultsPage />);
    await screen.findByText(/on a scale from 1.00 to 5.00/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
