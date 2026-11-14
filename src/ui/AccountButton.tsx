import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { lockNow } from '../security/AppLock';
import { pinLock } from '../security/pin';
import { forgetAccount, formatBytes, useAccount } from '../sync/account';
import { signIn, signOut } from '../sync/auth';
import type { SyncStatus } from '../sync/engine';
import { sync, useSyncStatus } from '../sync/instance';
import { Icon, type IconName } from './Icon';

/** How the sync state shows on the account picture: tick, turning ring, arrow, "!" or grey cloud. */
export type SyncTone = 'ok' | 'busy' | 'waiting' | 'alert' | 'off';

export function syncTone(status: SyncStatus): SyncTone {
  switch (status.state) {
    case 'idle':
      return 'ok';
    case 'syncing':
      return 'busy';
    case 'paused':
    case 'offline':
      return 'waiting';
    case 'error':
    case 'needs-sign-in':
      return 'alert';
    default:
      return 'off';
  }
}

const TONE_ICON: Record<SyncTone, IconName | null> = { ok: 'check', busy: null, waiting: 'upload', alert: 'warning', off: 'cloudOff' };

function ago(time: number | null): string {
  if (!time) return '';
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `at ${new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `on ${new Date(time).toLocaleDateString()}`;
}

/** One line describing the sync state, in plain words. */
export function syncSentence(status: SyncStatus, waiting: number): string {
  const pending = waiting ? ` ${waiting} page${waiting === 1 ? '' : 's'} waiting to upload.` : '';
  switch (status.state) {
    case 'idle':
      return `Synced ${ago(status.lastSyncedAt)}.`;
    case 'syncing':
      return 'Syncing with Google Drive.';
    case 'paused':
      return `Automatic sync is paused.${pending}`;
    case 'offline':
      return `Offline. Changes are saved on this iPad.${pending}`;
    case 'error':
      return `Sync failed. ${status.message}`;
    case 'needs-sign-in':
      return 'Google sign-in has expired. Sign in to resume syncing.';
    case 'signed-out':
      return 'Not connected. Notes are saved on this iPad only.';
    case 'not-configured':
      return 'Google Drive sync is not available in this build. Notes are saved on this iPad only.';
  }
}

/** The account picture with the sync badge on its corner. */
export function AccountAvatar({ size = 36, photo, name, tone }: { size?: number; photo?: string; name?: string; tone: SyncTone }) {
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const badge = TONE_ICON[tone];
  return (
    <span className={`account-avatar tone-${tone}`} style={{ width: size, height: size }}>
      {photo ? (
        <img src={photo} alt="" referrerPolicy="no-referrer" />
      ) : initials ? (
        <span className="account-initials">{initials}</span>
      ) : (
        <Icon name="user" size={Math.round(size * 0.55)} />
      )}
      {tone === 'busy' && <span className="account-ring" aria-hidden="true" />}
      {badge && (
        <span className="account-badge" aria-hidden="true">
          <Icon name={badge} size={10} />
        </span>
      )}
    </span>
  );
}

/** Sidebar footer: the account button, opening the account panel (sync, storage, settings). */
export function AccountButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = useSyncStatus();
  const tone = syncTone(status);
  const { account, loading, refresh } = useAccount();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const waiting = useLiveQuery(() => db.pages.where('dirty').equals(1).count(), []) ?? 0;
  const connected = !['signed-out', 'not-configured'].includes(status.state);

  useEffect(() => {
    if (!open) return;
    if (connected) void refresh(true);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = connected ? account?.name || 'Google account' : 'Not signed in';
  const usedShare = account?.driveLimit ? Math.min(1, account.driveUsed / account.driveLimit) : 0;
  const appShare = account?.driveLimit && account.appUsed !== null ? Math.min(1, account.appUsed / account.driveLimit) : 0;

  return (
    <div className="account" ref={rootRef}>
      {open && (
        <div className="account-panel" role="dialog" aria-label="Account">
          <div className="account-head">
            <AccountAvatar size={44} photo={connected ? account?.photo : undefined} name={connected ? account?.name : undefined} tone={tone} />
            <div className="account-id">
              <div className="account-name">{name}</div>
              <div className="account-email">{connected ? account?.email || 'Google Drive' : 'Sign in to sync with Google Drive'}</div>
            </div>
          </div>

          <div className="account-section">
            <div className={`account-status tone-${tone}`}>
              <Icon name={tone === 'ok' ? 'cloudCheck' : tone === 'alert' ? 'warning' : tone === 'off' ? 'cloudOff' : 'sync'} size={18} className={tone === 'busy' ? 'spin' : undefined} />
              <span>{syncSentence(status, waiting)}</span>
            </div>
            {connected && status.state !== 'needs-sign-in' && (
              <div className="account-actions">
                <button className="secondary" disabled={status.state === 'syncing'} onClick={() => void sync.syncNow(true)}>
                  <Icon name="sync" size={16} /> Sync now
                </button>
                <button className="secondary" onClick={() => sync.setPaused(!sync.isPaused)}>
                  <Icon name={sync.isPaused ? 'play' : 'pause'} size={16} /> {sync.isPaused ? 'Resume' : 'Pause'}
                </button>
              </div>
            )}
            {(status.state === 'signed-out' || status.state === 'needs-sign-in') && (
              <button className="primary account-signin" onClick={() => signIn()}>
                <Icon name="cloud" size={16} /> {status.state === 'signed-out' ? 'Connect Google Drive' : 'Sign in again'}
              </button>
            )}
          </div>

          {connected && account && (
            <div className="account-section">
              <div className="account-row">
                <span>
                  <Icon name="storage" size={18} /> Noteboard in Drive
                </span>
                <span className="muted">{account.appUsed === null ? (loading ? 'Calculating…' : '—') : formatBytes(account.appUsed)}</span>
              </div>
              {account.driveLimit !== null && (
                <>
                  <div className="storage-bar" aria-hidden="true">
                    <span className="storage-other" style={{ width: `${usedShare * 100}%` }} />
                    <span className="storage-app" style={{ width: `${appShare * 100}%` }} />
                  </div>
                  <div className="account-note">
                    {formatBytes(account.driveUsed)} of {formatBytes(account.driveLimit)} Drive storage used
                  </div>
                </>
              )}
            </div>
          )}

          <div className="account-section menu-like">
            <button
              className="menu-row"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Icon name="settings" size={18} /> Settings
            </button>
            {pinLock.hasPin() && (
              <button className="menu-row" onClick={lockNow}>
                <Icon name="lock" size={18} /> Lock Noteboard
              </button>
            )}
            {connected && (
              <button
                className="menu-row"
                onClick={() => {
                  if (confirm('Disconnect Google Drive on this iPad?\n\nYour notes remain on this iPad and in Google Drive.')) {
                    signOut();
                    forgetAccount();
                    setOpen(false);
                    void sync.syncNow();
                  }
                }}
              >
                <Icon name="logout" size={18} /> Disconnect Google Drive
              </button>
            )}
          </div>
        </div>
      )}
      <button className="account-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Account and sync. ${syncSentence(status, waiting)}`}>
        <AccountAvatar photo={connected ? account?.photo : undefined} name={connected ? account?.name : undefined} tone={tone} />
        <span className="account-button-text">
          <span className="account-name">{name}</span>
          <span className="account-email">{tone === 'busy' ? 'Syncing…' : tone === 'ok' ? 'Synced' : tone === 'waiting' ? (status.state === 'paused' ? 'Sync paused' : 'Offline') : tone === 'alert' ? 'Action required' : 'This iPad only'}</span>
        </span>
      </button>
    </div>
  );
}
