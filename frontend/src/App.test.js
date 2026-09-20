import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the public home page when signed out, with a way to sign in', () => {
  sessionStorage.clear();
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
});
