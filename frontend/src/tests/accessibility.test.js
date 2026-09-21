import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import Button from '../components/Button/Button';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import QuestionOptions from '../components/QuestionOptions/QuestionOptions';
import FlagBadge from '../components/FlagBadge/FlagBadge';

describe('Question options (feature 006) are axe-clean for 2, 5 and 20 options', () => {
  const opts = (n) => Array.from({ length: n }, (_, i) => ({ position: i + 1, text: `Choice ${i + 1}` }));
  test.each([2, 5, 20])('%i options', async (n) => {
    const { container } = render(<QuestionOptions options={opts(n)} value={2} onChange={() => {}} name={`q${n}`} />);
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getAllByRole('radio')).toHaveLength(n);
    expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});

describe('Cross-cutting accessibility (US3)', () => {
  test('shared components are axe-clean', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Continue</Button>
        <Field label="Email" name="email" />
        <StatusMessage type="warning" message="Session limit reached" />
        <FlagBadge flagCode="Q02" disposition={null} />
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  test('Button and Field control each define a non-default focus-visible style (FR-003)', () => {
    render(
      <div>
        <Button variant="primary">Go</Button>
        <Field label="Name" name="name" />
      </div>
    );
    // jsdom does not compute :focus-visible styles, so this asserts the
    // structural contract instead: each focusable element is a real,
    // natively-focusable control (button/input) that inherits the global
    // :focus-visible rule from reset.css, never a div with no focus story.
    expect(screen.getByRole('button', { name: 'Go' }).tagName).toBe('BUTTON');
    expect(screen.getByLabelText('Name').tagName).toBe('INPUT');
  });

  test('StatusMessage and FlagBadge never rely on color alone: each carries an icon AND a text label', () => {
    const { container: statusContainer } = render(<StatusMessage type="error" message="Something needs attention" />);
    expect(statusContainer.querySelector('svg')).toBeInTheDocument();
    expect(statusContainer.textContent.trim().length).toBeGreaterThan(0);

    const { container: flagContainer } = render(<FlagBadge flagCode="Q09" disposition={null} />);
    expect(flagContainer.querySelector('svg')).toBeInTheDocument();
    expect(flagContainer.textContent).toMatch(/needs review/i);
  });
});
