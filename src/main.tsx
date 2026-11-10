import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppLock } from './security/AppLock';
import { bounceToShellApp, getToken, handleRedirect, isConfigured, signIn, wasConnected } from './sync/auth';
import './pencil/bridge';
import './styles.css';

// Safari's own pinch-zoom of the whole page enlarges canvases as bitmaps (blurry ink); the
// editor implements its own sharp zoom instead.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

// No text selection outside form fields: a selection loupe can grab the Pencil mid-stroke.
document.addEventListener('selectstart', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('input, textarea, [contenteditable]')) e.preventDefault();
});

// The Noteboard Shell hands Google's answer back by changing only the URL fragment, which
// doesn't reload the page. Pick the answer up here, then restart cleanly with the new token.
window.addEventListener('hashchange', () => {
  if (location.hash.includes('access_token') || location.hash.includes('error=')) {
    handleRedirect();
    location.reload();
  }
});

function start(): void {
  // Opened inside the Noteboard Shell's sign-in sheet: pass Google's answer back to the app.
  if (bounceToShellApp()) return;

  const redirect = handleRedirect();

  // Google tokens last an hour and there is no backend to refresh them, so on launch we
  // quietly renew through Google (once per session, only when online).
  const SILENT_KEY = 'noteboard.silentSignInTried';
  const shouldRenew =
    redirect === 'none' &&
    isConfigured() &&
    wasConnected() &&
    !getToken() &&
    navigator.onLine &&
    !sessionStorage.getItem(SILENT_KEY);

  if (shouldRenew) {
    sessionStorage.setItem(SILENT_KEY, '1');
    signIn(true);
    return;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppLock>
        <App />
      </AppLock>
    </StrictMode>,
  );
}

start();
