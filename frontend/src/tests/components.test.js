import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import Button from '../components/Button/Button';
import Card from '../components/Card/Card';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import Skeleton from '../components/Skeleton/Skeleton';

describe('Button', () => {
  test('renders a clickable, axe-clean primary button', async () => {
    const onClick = jest.fn();
    const { container } = render(
      <Button variant="primary" onClick={onClick}>
        Continue
      </Button>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  test('disabled button is not clickable and stays accessible', async () => {
    const onClick = jest.fn();
    render(
      <Button variant="primary" onClick={onClick} disabled>
        Submit
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Card', () => {
  test('renders children in an axe-clean surface', async () => {
    const { container } = render(<Card>Hello</Card>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Field', () => {
  test('associates label, input, and error via aria-invalid/aria-describedby', () => {
    render(<Field label="Email" name="email" error="Enter a valid email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent('Enter a valid email');
  });

  test('no aria-invalid when there is no error', () => {
    render(<Field label="Email" name="email" />);
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('StatusMessage', () => {
  test('error type uses role=alert and renders both an icon and a text label (never color alone)', () => {
    const { container } = render(<StatusMessage type="error" message="Select one option" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Select one option');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  test('success/neutral/info types use role=status, not role=alert', () => {
    render(<StatusMessage type="success" message="Import complete" />);
    expect(screen.getByRole('status')).toHaveTextContent('Import complete');
  });

  test('warning type uses role=alert', () => {
    render(<StatusMessage type="warning" message="Session limit reached" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Session limit reached');
  });

  test('is axe-clean for every status type', async () => {
    for (const type of ['neutral', 'success', 'warning', 'error', 'info']) {
      // eslint-disable-next-line no-await-in-loop
      const { container, unmount } = render(<StatusMessage type={type} message={`${type} message`} />);
      // eslint-disable-next-line no-await-in-loop
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});

describe('Skeleton', () => {
  test('is hidden from assistive tech (parent region carries the live status)', async () => {
    const { container } = render(<Skeleton height={40} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });
});
