import { GOOGLE_CLIENT_ID } from '../config';

/**
 * Google sign-in without a backend: OAuth 2.0 token flow with a full-page redirect.
 * A redirect (rather than a popup) works reliably inside an installed iPad home-screen app.
 *
 * Scope `drive.file` only lets Noteboard see files it created itself — never the rest of
 * the user's Drive.
 */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'noteboard.google.token';
const STATE_KEY = 'noteboard.google.state';
const CONNECTED_KEY = 'noteboard.google.connected';

interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

function redirectUri(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

export function isConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

/** The user connected Google Drive on this device at some point (and hasn't disconnected). */
export function wasConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1';
}

export function getToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as StoredToken;
    // Treat tokens as expired a minute early so uploads never start with a dying token.
    return token.expiresAt - 60_000 > Date.now() ? token.accessToken : null;
  } catch {
    return null;
  }
}

/**
 * Sends the browser to Google. `silent` skips the consent screen when the user already
 * agreed before (Google still shows the account picker if it can't tell who is signed in).
 */
export function signIn(silent = false): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) params.set('prompt', 'none');
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export function signOut(): void {
  const token = getToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CONNECTED_KEY);
  if (token) {
    void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(
      () => undefined,
    );
  }
}

export function forgetToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type RedirectResult = 'none' | 'signed-in' | 'needs-interaction' | 'error';

/** Call once at startup: picks up the token Google appended to the URL after sign-in. */
export function handleRedirect(): RedirectResult {
  if (!location.hash.includes('access_token') && !location.hash.includes('error=')) return 'none';
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!expected || params.get('state') !== expected) return 'error';

  const error = params.get('error');
  if (error) {
    return error === 'interaction_required' || error === 'login_required' || error === 'consent_required'
      ? 'needs-interaction'
      : 'error';
  }
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  if (!accessToken) return 'error';
  const token: StoredToken = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  localStorage.setItem(CONNECTED_KEY, '1');
  return 'signed-in';
}
