import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { signOut, wasConnected } from '../sync/auth';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, isValidPin, pinLock } from './pin';
import { Icon } from '../ui/Icon';
import { lockAllNotebooks } from './notebookLock';

const LOCK_EVENT = 'noteboard-lock';

/** Locks the app immediately (e.g. from the sidebar). */
export function lockNow(): void {
  window.dispatchEvent(new Event(LOCK_EVENT));
}

/** Forgot-PIN escape hatch: wipes this device's copy. Notes in Google Drive are untouched. */
export async function resetThisDevice(): Promise<void> {
  signOut();
  pinLock.clear();
  db.close();
  await db.delete();
  for (const key of Object.keys(localStorage)) if (key.startsWith('noteboard.')) localStorage.removeItem(key);
  sessionStorage.clear();
  location.reload();
}

type LockState = 'setup' | 'locked' | 'unlocked';

/** Covers the app until the PIN is entered; first launch asks the user to create one. */
export function AppLock({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LockState>(() => (pinLock.hasPin() ? 'locked' : pinLock.skipped() ? 'unlocked' : 'setup'));

  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (!pinLock.hasPin() || pinLock.autoLockMinutes() < 0) return;
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        // "Immediately": lock before iPadOS takes the app-switcher snapshot.
        if (pinLock.autoLockMinutes() === 0) setState('locked');
      } else if (hiddenAt && Date.now() - hiddenAt >= pinLock.autoLockMinutes() * 60_000) {
        setState('locked');
      }
    };
    const onLock = () => pinLock.hasPin() && setState('locked');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(LOCK_EVENT, onLock);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(LOCK_EVENT, onLock);
    };
  }, []);

  // When the whole app locks, every notebook locks too.
  useEffect(() => {
    if (state === 'locked') lockAllNotebooks();
  }, [state]);

  const unlocked = state === 'unlocked';
  return (
    <>
      {state !== 'setup' && (
        <div className="app-root" style={unlocked ? undefined : { visibility: 'hidden' }} aria-hidden={!unlocked}>
          {children}
        </div>
      )}
      {!unlocked && (
        <LockScreen
          mode={state}
          onUnlocked={() => setState('unlocked')}
          onSkip={() => {
            pinLock.skipSetup();
            setState('unlocked');
          }}
        />
      )}
    </>
  );
}

function LockScreen({ mode, onUnlocked, onSkip }: { mode: 'setup' | 'locked'; onUnlocked: () => void; onSkip: () => void }) {
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitMs, setWaitMs] = useState(() => (mode === 'locked' ? pinLock.waitMs() : 0));
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (waitMs <= 0) return;
    const t = setInterval(() => setWaitMs(pinLock.waitMs()), 500);
    return () => clearInterval(t);
  }, [waitMs]);

  const fail = (text: string) => {
    setMessage(text);
    setPin('');
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const submit = useCallback(async () => {
    if (busy || waitMs > 0) return;
    if (mode === 'setup') {
      if (!isValidPin(pin)) return fail(`Use ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
      if (firstPin === null) {
        setFirstPin(pin);
        setPin('');
        setMessage('');
        return;
      }
      if (pin !== firstPin) {
        setFirstPin(null);
        return fail("PINs didn't match. Start again.");
      }
      setBusy(true);
      await pinLock.setPin(pin);
      setBusy(false);
      onUnlocked();
      return;
    }
    if (pin.length < PIN_MIN_LENGTH) return;
    setBusy(true);
    const result = await pinLock.verify(pin);
    setBusy(false);
    if (result.ok) return onUnlocked();
    setWaitMs(result.waitMs);
    fail(result.waitMs > 0 ? 'Too many attempts.' : 'Wrong PIN.');
  }, [busy, waitMs, mode, pin, firstPin, onUnlocked]);

  const press = useCallback(
    (key: string) => {
      setMessage('');
      if (key === 'del') setPin((p) => p.slice(0, -1));
      else setPin((p) => (p.length < PIN_MAX_LENGTH ? p + key : p));
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, submit]);

  const title =
    mode === 'locked' ? 'Enter PIN' : firstPin === null ? 'Create a PIN for Noteboard' : 'Enter the same PIN again';
  const seconds = Math.ceil(waitMs / 1000);

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-icon">
          <Icon name="lock" size={34} />
        </div>
        <h1>{title}</h1>
        {mode === 'setup' && firstPin === null && (
          <p className="lock-hint">
            {PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits to open Noteboard. You can change it or turn it off later in Settings.
          </p>
        )}
        <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(PIN_MIN_LENGTH, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? 'filled' : ''} />
          ))}
        </div>
        <div className="lock-message" role="alert">
          {waitMs > 0 ? `Too many attempts. Try again in ${seconds}s.` : message}
        </div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={waitMs > 0}>
              {d}
            </button>
          ))}
          <button className="keypad-aux" onClick={() => press('del')} aria-label="Delete">
            <Icon name="backspace" size={24} />
          </button>
          <button onClick={() => press('0')} disabled={waitMs > 0}>
            0
          </button>
          <button
            className="keypad-aux ok"
            onClick={() => void submit()}
            disabled={busy || waitMs > 0 || pin.length < PIN_MIN_LENGTH}
            aria-label="OK"
          >
            OK
          </button>
        </div>
        {mode === 'setup' && (
          <button className="link lock-forgot" onClick={onSkip}>
            Not now (no passcode)
          </button>
        )}
        {mode === 'locked' && (
          <button
            className="link lock-forgot"
            onClick={() => {
              const driveNote = wasConnected()
                ? 'Your notes in Google Drive are safe and will download again after you sign in to Google.'
                : 'Google Drive is NOT connected, so notes on this iPad will be lost permanently.';
              if (confirm(`Forgot your PIN?\n\nThis erases Noteboard on this iPad and lets you set a new PIN.\n\n${driveNote}`)) {
                void resetThisDevice();
              }
            }}
          >
            Forgot PIN?
          </button>
        )}
      </div>
    </div>
  );
}
