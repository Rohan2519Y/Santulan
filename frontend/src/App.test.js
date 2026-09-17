import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the login page when signed out', () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
