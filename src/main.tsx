import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppLock } from './security/AppLock';
import { ShareViewer } from './ui/ShareViewer';
import { bounceToShellApp, getToken, handleRedirect, isConfigured, signIn, wasConnected } from './sync/auth';
import './pencil/bridge';
import './styles.css';
import './palette.css';
import './library.css';
import './design.css';
import { applyTheme } from './ui/theme';

applyTheme();

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
  // A shared link (#/s/<id>): the read-only viewer, open to anyone (no app passcode, no sync).
  const shared = /^#\/s\/([\w-]+)/.exec(location.hash);
  if (shared) {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ShareViewer fileId={shared[1]!} />
      </StrictMode>,
    );
    hideSplash();
    return;
  }

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
  hideSplash();
}

/** Fades the launch logo out once the first screen is drawn (shown at least briefly, so it never flickers). */
function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const shownFor = performance.now();
  const remove = () => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 400);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(remove, Math.max(0, 650 - shownFor))));
  // Safety net if frames don't run (e.g. the page opened in the background).
  setTimeout(remove, 2500);
}

start();
