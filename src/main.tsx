/**
 * CuraFlow — Main Entry Point (Mandanten-App)
 *
 * Bootstraps the React application, sets up DB token from URL params,
 * and initializes console log capture for crash reports.
 *
 * @module main
 */

import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { initConsoleCapture } from '@/lib/ticketService';

// Capture console logs for crash reports
initConsoleCapture();

// ── URL DB Token Check (runs BEFORE React renders) ───────────────────────────
// This ensures the tenant token is set before any API calls are made.

const checkUrlToken = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  let dbToken = params.get('db_token');

  if (dbToken) {
    // URLSearchParams converts + to space — restore them
    dbToken = dbToken.replace(/ /g, '+');

    // Skip reload if the same token is already stored
    const currentToken = localStorage.getItem('db_credentials');
    if (currentToken === dbToken) {
      return false;
    }

    // Save synchronously to localStorage
    localStorage.setItem('db_credentials', dbToken);
    localStorage.setItem('db_token_enabled', 'true');
    localStorage.removeItem('active_token_id');

    // Clear JWT — user needs to re-login on new tenant
    localStorage.removeItem('radioplan_jwt_token');

    // Flag to prevent IndexedDB sync from overwriting
    sessionStorage.setItem('db_token_from_url', 'true');

    // Clean URL and reload
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    window.location.reload();
    return true;
  }
  return false;
};

// If a token was found in the URL, the page reloads — don't render React.
if (!checkUrlToken()) {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found in DOM');
  }

  ReactDOM.createRoot(rootElement).render(<App />);
}
