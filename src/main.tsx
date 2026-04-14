import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { setApiToast } from '@/api/client';
import { toast } from '@/components/ui/use-toast';

// Wire up toast notifications for the API client (breaks circular dependency)
setApiToast(toast);

// Check for db_token in URL BEFORE React renders
// This ensures the token is set before any API calls are made
const checkUrlToken = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  let dbToken = params.get('db_token');

  if (dbToken) {
    // URLSearchParams converts + to space, restore them
    dbToken = dbToken.replace(/ /g, '+');

    // Check if this is a different token than currently stored
    const currentToken = localStorage.getItem('db_credentials');
    if (currentToken === dbToken) {
      return false;
    }

    localStorage.setItem('db_credentials', dbToken);
    localStorage.setItem('db_token_enabled', 'true');
    localStorage.removeItem('active_token_id');
    localStorage.removeItem('radioplan_jwt_token');
    sessionStorage.setItem('db_token_from_url', 'true');

    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    window.location.reload();
    return true;
  }
  return false;
};

if (checkUrlToken()) {
  // Page will reload, don't render React
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeUpdate', () => {
      window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
    });
    import.meta.hot.on('vite:afterUpdate', () => {
      window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
    });
  }
}
