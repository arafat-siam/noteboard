import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { SyncEngine, type SyncStatus } from './engine';
import { penActiveWithin } from '../ink/penState';

export const sync = new SyncEngine(db);
// Don't sync mid-handwriting: wait until the Pencil has rested for 3 seconds.
sync.deferWhile(() => penActiveWithin(3_000));

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(sync.current);
  useEffect(() => sync.subscribe(setStatus), []);
  return status;
}
