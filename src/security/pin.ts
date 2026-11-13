/**
 * App lock PIN. The PIN itself is never stored: only a salted PBKDF2 hash, on this device.
 * It is not hard-coded anywhere because the source code is public.
 *
 * This is a lock screen (like the iPad's own), not encryption of the notes on disk.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredPin {
  salt: string;
  hash: string;
  iterations: number;
}

interface Attempts {
  failures: number;
  lockedUntil: number;
}

const PIN_KEY = 'noteboard.pin';
const ATTEMPTS_KEY = 'noteboard.pin.attempts';
const AUTOLOCK_KEY = 'noteboard.pin.autolock';
const SKIPPED_KEY = 'noteboard.pin.skipped';
const ITERATIONS = 210_000;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
/** After this many wrong PINs, each further mistake adds a growing wait. */
export const FREE_ATTEMPTS = 5;

export type VerifyResult = { ok: true } | { ok: false; waitMs: number; failures: number };

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toB64(new Uint8Array(bits));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A salted PBKDF2 hash of a secret (notebook passcodes use this too; the secret is never stored). */
export interface SecretHash {
  salt: string;
  hash: string;
  iterations: number;
}

export async function hashSecret(secret: string): Promise<SecretHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await derive(secret, salt, ITERATIONS), iterations: ITERATIONS };
}

export async function checkSecret(stored: SecretHash, secret: string): Promise<boolean> {
  return constantTimeEqual(await derive(secret, fromB64(stored.salt), stored.iterations), stored.hash);
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** Wait required after `failures` wrong attempts: 30 s, 1 min, 2 min, 4 min … capped at 1 hour. */
export function lockoutMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(60 * 60_000, 30_000 * 2 ** (failures - FREE_ATTEMPTS));
}

export class PinLock {
  constructor(private readonly store: KeyValueStore, private readonly now: () => number = Date.now) {}

  hasPin(): boolean {
    return this.store.getItem(PIN_KEY) !== null;
  }

  async setPin(pin: string): Promise<void> {
    if (!isValidPin(pin)) throw new Error(`PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const stored: StoredPin = { salt: toB64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
    this.store.setItem(PIN_KEY, JSON.stringify(stored));
    this.store.removeItem(ATTEMPTS_KEY);
    this.store.removeItem(SKIPPED_KEY);
  }

  private attempts(): Attempts {
    try {
      return { failures: 0, lockedUntil: 0, ...(JSON.parse(this.store.getItem(ATTEMPTS_KEY) ?? '{}') as Partial<Attempts>) };
    } catch {
      return { failures: 0, lockedUntil: 0 };
    }
  }

  /** Milliseconds until another attempt is allowed (0 = now). */
  waitMs(): number {
    return Math.max(0, this.attempts().lockedUntil - this.now());
  }

  async verify(pin: string): Promise<VerifyResult> {
    const raw = this.store.getItem(PIN_KEY);
    if (!raw) return { ok: true };
    const attempts = this.attempts();
    const wait = attempts.lockedUntil - this.now();
    if (wait > 0) return { ok: false, waitMs: wait, failures: attempts.failures };

    const stored = JSON.parse(raw) as StoredPin;
    const hash = await derive(pin, fromB64(stored.salt), stored.iterations);
    if (constantTimeEqual(hash, stored.hash)) {
      this.store.removeItem(ATTEMPTS_KEY);
      return { ok: true };
    }
    const failures = attempts.failures + 1;
    const waitMs = lockoutMs(failures);
    this.store.setItem(ATTEMPTS_KEY, JSON.stringify({ failures, lockedUntil: this.now() + waitMs }));
    return { ok: false, waitMs, failures };
  }

  async changePin(currentPin: string, newPin: string): Promise<VerifyResult> {
    const result = await this.verify(currentPin);
    if (result.ok) await this.setPin(newPin);
    return result;
  }

  clear(): void {
    this.store.removeItem(PIN_KEY);
    this.store.removeItem(ATTEMPTS_KEY);
  }

  /** Turns the passcode off (needs the current PIN). Noteboard then opens without asking. */
  async turnOff(currentPin: string): Promise<VerifyResult> {
    const result = await this.verify(currentPin);
    if (result.ok) {
      this.clear();
      this.store.setItem(SKIPPED_KEY, '1');
    }
    return result;
  }

  /** The user chose not to use a passcode (first launch "Not now", or turned it off). */
  skipped(): boolean {
    return this.store.getItem(SKIPPED_KEY) === '1';
  }

  skipSetup(): void {
    this.store.setItem(SKIPPED_KEY, '1');
  }

  /** Minutes in the background before the app locks again (0 = immediately, -1 = never). */
  autoLockMinutes(): number {
    const value = Number(this.store.getItem(AUTOLOCK_KEY) ?? '1');
    return Number.isFinite(value) && value >= -1 ? value : 1;
  }

  setAutoLockMinutes(minutes: number): void {
    this.store.setItem(AUTOLOCK_KEY, String(minutes));
  }
}

function browserStore(): KeyValueStore {
  try {
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}

export const pinLock = typeof window === 'undefined' ? (null as unknown as PinLock) : new PinLock(browserStore());
