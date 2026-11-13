import type { Notebook, NotebookLock } from '../model/types';
import { checkSecret, hashSecret } from './pin';

/**
 * Per-notebook passcodes. Only a salted hash is stored (and synced, so the lock is the same on
 * every device). Which notebooks are unlocked right now is kept in memory only: closing the
 * app always locks them again.
 */
export const NOTEBOOK_PASSCODE_MIN = 4;
export const NOTEBOOK_PASSCODE_MAX = 64;

export function isValidNotebookPasscode(passcode: string): boolean {
  return passcode.length >= NOTEBOOK_PASSCODE_MIN && passcode.length <= NOTEBOOK_PASSCODE_MAX;
}

export async function makeNotebookLock(passcode: string, relockMinutes = 0): Promise<NotebookLock> {
  return { ...(await hashSecret(passcode)), relockMinutes };
}

export function checkNotebookPasscode(lock: NotebookLock, passcode: string): Promise<boolean> {
  return checkSecret(lock, passcode);
}

/** notebook id -> when it was unlocked (ms). */
const unlocked = new Map<string, number>();
/** The passcode typed this session, kept in memory only (sharing a locked notebook encrypts with it). */
const passcodes = new Map<string, string>();

export function isNotebookUnlocked(notebook: Notebook, now = Date.now()): boolean {
  if (!notebook.lock) return true;
  const at = unlocked.get(notebook.id);
  if (at === undefined) return false;
  const minutes = notebook.lock.relockMinutes;
  if (minutes > 0 && now - at > minutes * 60_000) {
    lockNotebook(notebook.id);
    return false;
  }
  return true;
}

export function markNotebookUnlocked(id: string, passcode?: string): void {
  unlocked.set(id, Date.now());
  if (passcode) passcodes.set(id, passcode);
}

export function lockNotebook(id: string): void {
  unlocked.delete(id);
  passcodes.delete(id);
}

/** Called when a notebook is closed: "lock when closed" notebooks lock again. */
export function notebookClosed(notebook: Notebook | undefined): void {
  if (notebook?.lock && notebook.lock.relockMinutes === 0) lockNotebook(notebook.id);
}

export function sessionPasscode(id: string): string | undefined {
  return passcodes.get(id);
}

/** Locks every notebook (when the whole app locks). */
export function lockAllNotebooks(): void {
  unlocked.clear();
  passcodes.clear();
}
