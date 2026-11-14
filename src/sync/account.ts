import { useCallback, useEffect, useState } from 'react';
import { getToken } from './auth';
import { DriveClient, type DriveAbout } from './drive';

/** The Google account and storage figures, remembered on this device so they show offline too. */
export interface AccountInfo extends DriveAbout {
  /** Bytes used by Noteboard's own files in Drive. */
  appUsed: number | null;
  checkedAt: number;
}

const KEY = 'noteboard.account';

function read(): AccountInfo | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as AccountInfo | null;
  } catch {
    return null;
  }
}

export function forgetAccount(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Account details for the sidebar. `refresh(withUsage)` asks Drive again; adding up Noteboard's
 * own file sizes lists every file, so it's done only when the account panel is open.
 */
export function useAccount(): { account: AccountInfo | null; loading: boolean; refresh: (withUsage?: boolean) => Promise<void> } {
  const [account, setAccount] = useState<AccountInfo | null>(read);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (withUsage = false) => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const drive = new DriveClient(token);
      const [about, appUsed] = await Promise.all([drive.about(), withUsage ? drive.appUsage() : Promise.resolve(null)]);
      const next: AccountInfo = { ...about, appUsed: appUsed ?? read()?.appUsed ?? null, checkedAt: Date.now() };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      setAccount(next);
    } catch {
      // Offline or signed out: keep showing what we last knew.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Name and photo once a day is plenty.
    const known = read();
    if (!known || Date.now() - known.checkedAt > 24 * 3600_000) void refresh(false);
  }, [refresh]);

  return { account, loading, refresh };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
