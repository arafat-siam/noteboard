import { signIn, signOut } from '../sync/auth';
import { sync, useSyncStatus } from '../sync/instance';

function ago(time: number | null): string {
  if (!time) return '';
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Google Drive connection and sync state. `compact` is for the editor toolbar. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();

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
      return <div className="sync-badge">⟳ Syncing…</div>;
    case 'offline':
      return <div className="sync-badge muted">Offline · will sync later</div>;
    case 'error':
      return (
        <button className="sync-badge warn" title={status.message} onClick={() => void sync.syncNow()}>
          ⚠️ Sync failed · retry
        </button>
      );
    case 'idle':
      return (
        <div className="sync-badge ok">
          <button className="link" onClick={() => void sync.syncNow()}>
            ✓ Synced {ago(status.lastSyncedAt)}
          </button>
          {!compact && (
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
          )}
        </div>
      );
  }
}
