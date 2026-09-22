import { screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { HomePage, AboutPage, GetStartedPage, SupportPage } from '../pages/public/PublicPages';
import { renderPage } from './testUtils';

const EXISTING_ROUTES = ['/', '/about', '/get-started', '/login', '/register', '/support'];

describe('public pages (T115)', () => {
  test.each([['Home', HomePage], ['About', AboutPage], ['Get started', GetStartedPage], ['Support', SupportPage]])('%s renders a level-1 heading', (name, Page) => {
    renderPage(<Page />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  test('Get started shows the two route cards, each with a working link to an existing page', () => {
    renderPage(<GetStartedPage />);
    const open = screen.getByRole('heading', { name: /register as an individual/i }).closest('section');
    const institution = screen.getByRole('heading', { name: /join through your institution/i }).closest('section');
    expect(within(open).getByRole('link', { name: /register/i })).toHaveAttribute('href', '/register');
    expect(within(institution).getByRole('link', { name: /sign in with a santulan id/i })).toHaveAttribute('href', '/login');   // no self-join by code (D-02)
  });

  test('every internal link (header and footer included) points only at pages that exist', () => {
    const { container } = renderPage(<HomePage />);
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) expect(EXISTING_ROUTES).toContain(href);
  });

  test('the language select offers only English', () => {
    renderPage(<HomePage />);
    const select = screen.getByLabelText('Language');
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['en']);
  });

  test('the header action is "Get Started" when signed out', () => {
    renderPage(<HomePage />);
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
  });

  test.each([['Home', HomePage], ['About', AboutPage], ['Get started', GetStartedPage], ['Support', SupportPage]])('%s is axe-clean', async (name, Page) => {
    const { container } = renderPage(<Page />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
