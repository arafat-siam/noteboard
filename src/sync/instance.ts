import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { SyncEngine, type SyncStatus } from './engine';

export const sync = new SyncEngine(db);

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(sync.current);
  useEffect(() => sync.subscribe(setStatus), []);
  return status;
}
