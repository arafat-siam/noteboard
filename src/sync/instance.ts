import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { SyncEngine, type SyncStatus } from './engine';
import { hoveredWithin, penActiveWithin } from '../ink/penState';

export const sync = new SyncEngine(db);
// Sync never competes with the Pencil: it waits while you write (and 3 s after) and while the
// Pencil hovers (sync work on the main thread made the hover pointer stutter and look doubled).
sync.deferWhile(() => penActiveWithin(3_000) || hoveredWithin(1_500));

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(sync.current);
  useEffect(() => sync.subscribe(setStatus), []);
  return status;
}
