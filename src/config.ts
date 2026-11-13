/**
 * Google OAuth client ID (public — it identifies the app, it is not a secret).
 * Set at build time from the GOOGLE_CLIENT_ID repository variable, or in a local .env file
 * as VITE_GOOGLE_CLIENT_ID for development.
 */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

/**
 * Google API key (public by design, restricted in Google Cloud to this website): lets people
 * without a Google account open shared links. Set from the GOOGLE_API_KEY repository variable,
 * or VITE_GOOGLE_API_KEY in a local .env file.
 */
export const GOOGLE_API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() ?? '';
