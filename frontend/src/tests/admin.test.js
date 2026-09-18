import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import FlagBadge from '../components/FlagBadge/FlagBadge';
import StatusMessage from '../components/StatusMessage/StatusMessage';

describe('FlagBadge', () => {
  test('a flag with no disposition renders "needs review" with its own icon/label', () => {
    const { container } = render(<FlagBadge flagCode="Q07" disposition={null} />);
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    expect(screen.getByText('Q07')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  test('a dispositioned flag renders "reviewed" distinctly from needs-review (icon+label, not color alone)', () => {
    render(<FlagBadge flagCode="Q01" disposition="No action needed" />);
    expect(screen.getByText(/reviewed/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument();
  });

  test('is axe-clean in both states', async () => {
    const needsReview = render(<FlagBadge flagCode="Q09" disposition={null} />);
    expect(await axe(needsReview.container)).toHaveNoViolations();
    needsReview.unmount();
    const reviewed = render(<FlagBadge flagCode="Q09" disposition="Escalated" />);
    expect(await axe(reviewed.container)).toHaveNoViolations();
  });
});

describe('Import outcome messaging (StatusMessage reuse)', () => {
  test('success and failure outcomes render with distinct roles/icons, not identical text blocks', () => {
    const success = render(<StatusMessage type="success" message="Import complete — 175 items live" />);
    expect(success.getByRole('status')).toHaveTextContent('Import complete');
    success.unmount();

    const failure = render(<StatusMessage type="error" message="Import failed" />);
    expect(failure.getByRole('alert')).toHaveTextContent('Import failed');
  });
});
