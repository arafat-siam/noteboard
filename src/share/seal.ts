/**
 * Encryption for shared copies of locked notebooks: AES-GCM 256 with a key derived from the
 * notebook passcode (PBKDF2-SHA-256, 310 000 rounds, random salt). Without the passcode the
 * shared file is unreadable. Format: "NBE1" | salt (16) | iv (12) | ciphertext.
 */
const MAGIC = new TextEncoder().encode('NBE1');
const ITERATIONS = 310_000;

async function keyFor(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.length > 32 && MAGIC.every((b, i) => bytes[i] === b);
}

export async function seal(data: Uint8Array, passcode: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(passcode, salt), data));
  const out = new Uint8Array(4 + 16 + 12 + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, 4);
  out.set(iv, 20);
  out.set(cipher, 32);
  return out;
}

export class WrongPasscodeError extends Error {}

/** Decrypts; throws WrongPasscodeError if the passcode is wrong (or the data was changed). */
export async function unseal(sealed: Uint8Array, passcode: string): Promise<Uint8Array> {
  if (!isSealed(sealed)) throw new Error('Not an encrypted Noteboard file.');
  const salt = sealed.slice(4, 20);
  const iv = sealed.slice(20, 32);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await keyFor(passcode, salt), sealed.slice(32)));
  } catch {
    throw new WrongPasscodeError('Wrong passcode.');
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
