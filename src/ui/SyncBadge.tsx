import type { ReactNode } from 'react';
import { signIn, signOut } from '../sync/auth';
import { sync, useSyncStatus } from '../sync/instance';

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
        ⟳
      </button>
      <button
        className="sync-control"
        title={paused ? 'Resume automatic sync' : 'Pause automatic sync'}
        aria-label={paused ? 'Resume automatic sync' : 'Pause automatic sync'}
        onClick={() => sync.setPaused(!paused)}
      >
        {paused ? '▶' : '⏸'}
      </button>
    </span>
  );
}

/** Google Drive connection and sync state. `compact` is for the editor toolbar. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const paused = sync.isPaused;

  const connected = (tone: string, label: ReactNode, extra?: ReactNode) => (
    <div className={`sync-badge ${tone}`}>
      <span className="sync-label">{label}</span>
      <SyncControls paused={paused} syncing={status.state === 'syncing'} />
      {extra}
    </div>
  );

  switch (status.state) {
    case 'not-configured':
      return compact ? null : <div className="sync-badge muted">Drive sync not set up yet · notes are saved on this iPad</div>;
    case 'signed-out':
      return (
        <button className="sync-badge action" onClick={() => signIn()}>
          ☁️ Connect Google Drive
        </button>
      );
    case 'needs-sign-in':
      return (
        <button className="sync-badge warn" onClick={() => signIn()}>
          ⚠️ Sign in to keep syncing
        </button>
      );
    case 'syncing':
      return connected('', '⟳ Syncing…');
    case 'paused':
      return connected(
        'warn',
        compact ? '⏸ Sync paused' : `⏸ Sync paused${status.lastSyncedAt ? ` · last ${ago(status.lastSyncedAt)}` : ''}`,
      );
    case 'offline':
      return connected('muted', 'Offline · will sync later');
    case 'error':
      return connected('warn', <span title={status.message}>⚠️ Sync failed</span>);
    case 'idle':
      return connected(
        'ok',
        `✓ Synced ${ago(status.lastSyncedAt)}`,
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
            Disconnect
          </button>
        ),
      );
  }
}
