import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

document.title = 'Krytz - Your life, reconstructed.';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);

    if (isLocalPreview) {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(err => console.warn('[Krytz] SW cleanup failed:', err));
      return;
    }

    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[Krytz] SW registered, scope:', reg.scope);
        setInterval(() => reg.update(), 60 * 60 * 1000);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[Krytz] New version available. Refresh to update.');
            }
          });
        });
      })
      .catch(err => console.warn('[Krytz] SW registration failed:', err));
  });
}
