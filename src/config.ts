/**
 * Google OAuth client ID (public — it identifies the app, it is not a secret).
 * Set at build time from the GOOGLE_CLIENT_ID repository variable, or in a local .env file
 * as VITE_GOOGLE_CLIENT_ID for development.
 */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
