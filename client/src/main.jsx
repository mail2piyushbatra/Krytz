import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

document.title = 'Flowra — Your life, reconstructed.'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ── Service Worker Registration ─────────────────────────────────────
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[Flowra] SW registered, scope:', reg.scope);

        // Check for updates periodically
        setInterval(() => reg.update(), 60 * 60 * 1000); // hourly

        // Notify user when update is available
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content available — could show a toast here
              console.log('[Flowra] New version available — refresh to update.');
            }
          });
        });
      })
      .catch(err => console.warn('[Flowra] SW registration failed:', err));
  });
}
