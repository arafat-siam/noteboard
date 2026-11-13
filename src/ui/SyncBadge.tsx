import type { ReactNode } from 'react';
import { signIn, signOut } from '../sync/auth';
import { sync, useSyncStatus } from '../sync/instance';
import { Icon } from './Icon';

function ago(time: number | null): string {
  if (!time) return '';
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "Sync now" and "Pause / Resume" controls, shown whenever Google Drive is connected. */
function SyncControls({ paused, syncing }: { paused: boolean; syncing: boolean }) {
  return (
    <span className="sync-controls">
      <button
        className="sync-control"
        title="Sync now"
        aria-label="Sync now"
        disabled={syncing}
        onClick={() => void sync.syncNow(true)}
      >
        <Icon name="sync" size={16} />
      </button>
      <button
        className="sync-control"
        title={paused ? 'Resume automatic sync' : 'Pause automatic sync'}
        aria-label={paused ? 'Resume automatic sync' : 'Pause automatic sync'}
        onClick={() => sync.setPaused(!paused)}
      >
        <Icon name={paused ? 'play' : 'pause'} size={16} />
      </button>
    </span>
  );
}

/** Google Drive connection and sync state. `compact` is for the editor toolbar. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const paused = sync.isPaused;

  /** Icon + status text (cut short with "…" if needed) on the left, Sync now / Pause on the right. */
  const connected = (tone: string, icon: ReactNode, text: string, extra?: ReactNode, title?: string) => (
    <div className={`sync-badge ${tone}`}>
      <span className="sync-label" title={title ?? text}>
        {icon}
        <span className="sync-text">{text}</span>
      </span>
      <SyncControls paused={paused} syncing={status.state === 'syncing'} />
      {extra && <div className="sync-extra">{extra}</div>}
    </div>
  );

  switch (status.state) {
    case 'not-configured':
      return compact ? null : (
        <div className="sync-badge muted">
          <Icon name="tablet" size={16} />
          <span className="sync-text wrap">Saved on this iPad (Drive sync not set up)</span>
        </div>
      );
    case 'signed-out':
      return (
        <button className="sync-badge action" onClick={() => signIn()}>
          <Icon name="cloud" size={16} /> Connect Google Drive
        </button>
      );
    case 'needs-sign-in':
      return (
        <button className="sync-badge warn" onClick={() => signIn()}>
          <Icon name="warning" size={16} /> Sign in to keep syncing
        </button>
      );
    case 'syncing':
      return connected('', <Icon name="sync" size={16} className="spin" />, 'Syncing');
    case 'paused':
      return connected(
        'warn',
        <Icon name="pause" size={16} />,
        compact ? 'Paused' : `Sync paused${status.lastSyncedAt ? ` · ${ago(status.lastSyncedAt)}` : ''}`,
      );
    case 'offline':
      return connected('muted', <Icon name="cloudOff" size={16} />, compact ? 'Offline' : 'Offline · syncs later');
    case 'error':
      return connected('warn', <Icon name="warning" size={16} />, 'Sync failed', undefined, status.message);
    case 'idle':
      return connected(
        'ok',
        <Icon name="cloudCheck" size={16} />,
        compact ? 'Synced' : `Synced ${ago(status.lastSyncedAt)}`,
        !compact && (
          <button
            className="link muted"
            onClick={() => {
              if (confirm('Disconnect Google Drive on this iPad? Your notes stay on this iPad and in Drive.')) {
                signOut();
                void sync.syncNow();
              }
            }}
          >
            Disconnect Google Drive
          </button>
        ),
      );
  }
}
