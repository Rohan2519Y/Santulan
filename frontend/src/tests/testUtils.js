import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../services/SessionContext';

/** Renders a page inside a router and the session provider, like the real app. */
export const renderPage = (ui, { route = '/' } = {}) => render(
  <SessionProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></SessionProvider>,
);

/** The text a screen reader would meet on the page. */
export const pageText = (container) => container.textContent.replace(/\s+/g, ' ');
