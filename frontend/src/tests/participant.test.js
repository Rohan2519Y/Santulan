import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import ProgressSummary from '../components/ProgressSummary/ProgressSummary';
import ScoreCard from '../components/ScoreCard/ScoreCard';

describe('ProgressSummary', () => {
  test('exposes a progressbar with answered/total, current domain, and session count', () => {
    render(<ProgressSummary answered={3} total={10} domainName="Emotional Capability" sessionCount={2} maxSessions={4} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(screen.getAllByText(/Emotional Capability/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/session 2 of 4/i).length).toBeGreaterThan(0);
  });

  test('is axe-clean', async () => {
    const { container } = render(<ProgressSummary answered={1} total={5} domainName="C1" sessionCount={1} maxSessions={4} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ScoreCard', () => {
  test('renders a normal result with its score and completeness', () => {
    render(<ScoreCard domainName="Body & Self-Regulation" rawScore={3.8} completenessRate={0.95} scoreStatus="S2" />);
    expect(screen.getByText('Body & Self-Regulation')).toBeInTheDocument();
    expect(screen.getByText(/3.8/)).toBeInTheDocument();
  });

  test('renders a held/neutral result distinctly, without an error treatment', () => {
    render(<ScoreCard domainName="Identity & Self-Concept" rawScore={null} completenessRate={1} scoreStatus="SH" />);
    expect(screen.getByRole('status')).toHaveTextContent(/under review/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('is axe-clean for both normal and neutral states', async () => {
    const normal = render(<ScoreCard domainName="C1" rawScore={4.1} completenessRate={1} scoreStatus="S2" />);
    expect(await axe(normal.container)).toHaveNoViolations();
    normal.unmount();
    const neutral = render(<ScoreCard domainName="C4" rawScore={null} completenessRate={0.4} scoreStatus="S0" />);
    expect(await axe(neutral.container)).toHaveNoViolations();
  });
});
