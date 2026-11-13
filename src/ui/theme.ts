import { useEffect, useState } from 'react';

/**
 * Appearance: follow the iPad (Light / Dark set in Settings > Display & Brightness), or always
 * light / always dark. Stored on this device. index.html applies it before the app loads so the
 * launch screen is already in the right colours.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'noteboard.theme';
const EVENT = 'noteboard-theme';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function isDark(choice: ThemeChoice): boolean {
  return choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

export function applyTheme(choice: ThemeChoice = getTheme()): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  // The status bar / Safari chrome colour follows the app background.
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', isDark(choice) ? '#0b0b0d' : '#f4f4f7');
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode */
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(EVENT));
}

/** Current choice, updated when it changes anywhere in the app. */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState(getTheme);
  useEffect(() => {
    const on = () => setChoice(getTheme());
    window.addEventListener(EVENT, on);
    // Following the iPad: keep the status bar colour right when it switches.
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => getTheme() === 'system' && applyTheme('system');
    mq?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(EVENT, on);
      mq?.removeEventListener?.('change', onSystem);
    };
  }, []);
  return [choice, setTheme];
}
