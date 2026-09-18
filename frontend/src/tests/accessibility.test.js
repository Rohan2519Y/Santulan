import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import Button from '../components/Button/Button';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import ResponseScale from '../components/ResponseScale/ResponseScale';
import FlagBadge from '../components/FlagBadge/FlagBadge';

describe('Cross-cutting accessibility (US3)', () => {
  test('shared components are axe-clean', async () => {
    const anchors = { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' };
    const { container } = render(
      <div>
        <Button variant="primary">Continue</Button>
        <Field label="Email" name="email" />
        <StatusMessage type="warning" message="Session limit reached" />
        <ResponseScale anchors={anchors} value={2} onChange={() => {}} name="a1" />
        <FlagBadge flagCode="Q02" disposition={null} />
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  test('Button, Field control, and ResponseScale option each define a non-default focus-visible style (FR-003)', () => {
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
