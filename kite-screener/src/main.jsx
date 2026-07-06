import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Match Kite's typography: it loads Open Sans (300/400/600) from Google Fonts.
// The injected /local-screener page doesn't include Kite's own <head> CSS, so
// we load the same font ourselves (Kite's origin CSP already allows Google Fonts).
function ensureKiteFont() {
  const href = 'https://fonts.googleapis.com/css?family=Open+Sans:300,400,600&display=swap';
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

ensureKiteFont();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
