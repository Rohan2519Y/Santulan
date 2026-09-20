import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import Button from '../components/Button/Button';
import Card from '../components/Card/Card';
import { Breadcrumb, SelectableCard, SplitHero, Toggle } from '../components/participantKit';
import { PreferencesPage, ThanksPage } from '../pages/participant/AccountPages';
import { applyPreferences, getReduceMotion, getTheme } from '../services/preferences';
import { renderPage, pageText } from './testUtils';

beforeEach(() => { localStorage.clear(); applyPreferences({ theme: 'light', reduceMotion: false }); });

describe('Button and Card variants (T121)', () => {
  test('the two route buttons and quiet-link render as real buttons with their variant class', () => {
    render(<><Button variant="route-open">Register</Button><Button variant="route-institution">Sign in</Button><Button variant="quiet-link">Later</Button></>);
    for (const name of ['Register', 'Sign in', 'Later']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' }).className).toMatch(/route-open/);
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toMatch(/route-institution/);
  });

  test('Card accepts a tone from the measured tints and ignores unknown tones', () => {
    render(<><Card tone="green" data-testid="g">a</Card><Card tone="nonsense" data-testid="n">b</Card><Card data-testid="d">c</Card></>);
    expect(screen.getByTestId('g').className).toMatch(/tone-green/);
    expect(screen.getByTestId('n').className).not.toMatch(/tone-/);
    expect(screen.getByTestId('d').className).not.toMatch(/tone-/);
  });
});

describe('kit components (T123, T124)', () => {
  test('SplitHero renders copy and its aside; SelectableCard is a labelled radio with a selected state', async () => {
    const onChange = jest.fn();
    const { container } = renderPage(<><SplitHero aside={<p>aside</p>}><h1>Hello</h1></SplitHero><SelectableCard name="x" value="a" checked={false} onChange={onChange}>Option A</SelectableCard></>);
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByText('aside')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Option A'));
    expect(onChange).toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  test('Breadcrumb links every step but the current page, which is marked aria-current', () => {
    renderPage(<Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile', to: '/student/profile' }, { label: 'Preferences' }]} />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/student');
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute('href', '/student/profile');
    expect(screen.queryByRole('link', { name: 'Preferences' })).not.toBeInTheDocument();
    expect(screen.getByText('Preferences').closest('li')).toHaveAttribute('aria-current', 'page');
  });

  test('Toggle is a labelled switch that reports its new state', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<Toggle label="Reduce motion" hint="Turns off animations." checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Toggle label="Reduce motion" hint="Turns off animations." checked onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Preferences and Thanks pages (T134)', () => {
  test('Preferences offers only the language that exists, and a theme choice that applies immediately and is remembered', async () => {
    const { container } = renderPage(<PreferencesPage />);
    const language = screen.getByLabelText('Language');
    expect([...language.querySelectorAll('option')].map((o) => o.value)).toEqual(['en']);
    expect(getTheme()).toBe('light');
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(getTheme()).toBe('dark');
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(pageText(container)).not.toMatch(/notification|learning preference|interests/i);   // deferred items are absent
    expect(await axe(container)).toHaveNoViolations();
  });

  test('the Reduce motion switch sets and persists the preference', async () => {
    renderPage(<PreferencesPage />);
    await userEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    expect(getReduceMotion()).toBe(true);
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true');
  });

  test('preferences still work when storage is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getTheme()).toBe('light');
    expect(getReduceMotion()).toBe(false);
    spy.mockRestore();
  });

  test('Thanks links only to pages that exist and offers no Take Action or Resources', () => {
    const { container } = renderPage(<ThanksPage />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['/student', '/student/generating', '/student/support']);
    expect(pageText(container)).not.toMatch(/take action|explore resources/i);
  });
});
