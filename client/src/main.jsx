import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

document.title = 'Krytz â€” Your life, reconstructed.'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// â”€â”€ Service Worker Registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[Krytz] SW registered, scope:', reg.scope);

        // Check for updates periodically
        setInterval(() => reg.update(), 60 * 60 * 1000); // hourly

        // Notify user when update is available
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content available â€” could show a toast here
              console.log('[Krytz] New version available â€” refresh to update.');
            }
          });
        });
      })
      .catch(err => console.warn('[Krytz] SW registration failed:', err));
  });
}
