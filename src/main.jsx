import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Check for db_token in URL BEFORE React renders
// This ensures the token is set before any API calls are made
const checkUrlToken = () => {
    const params = new URLSearchParams(window.location.search);
    let dbToken = params.get('db_token');
    
    if (dbToken) {
        // URLSearchParams converts + to space, restore them
        dbToken = dbToken.replace(/ /g, '+');
        
        // Check if this is a different token than currently stored
        const currentToken = localStorage.getItem('db_credentials');
        if (currentToken === dbToken) {
            // Same token, no need to reload
            return false;
        }
        
        // Save synchronously to localStorage
        localStorage.setItem('db_credentials', dbToken);
        localStorage.setItem('db_token_enabled', 'true');
        localStorage.removeItem('active_token_id');
        
        // Clear JWT token - user needs to re-login on new tenant
        localStorage.removeItem('radioplan_jwt_token');
        
        // Set a flag to indicate fresh token from URL - prevents IndexedDB sync from overwriting
        sessionStorage.setItem('db_token_from_url', 'true');
        
        // Clean URL and reload
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        window.location.reload();
        return true;
    }
    return false;
};

// If token found in URL, this will reload the page
if (checkUrlToken()) {
    // Page will reload, don't render React
} else {

// v1.0.3 - Custom categories in scheduler
ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}

} // End of else block for checkUrlToken



