import type { NoteboardDB } from '../db/db';
import type { LibraryItem, Page } from '../model/types';
import { DriveAuthError, DriveClient, type DriveFile } from './drive';
import { mergeLibrary, mergePage, samePageContent } from './merge';
import { forgetToken, getToken, isConfigured, wasConnected } from './auth';

/**
 * Google Drive is Noteboard's database. Layout inside the visible "Noteboard" Drive folder:
 *   library.json            all folders and notebooks (small)
 *   page_<pageId>.json      one file per page (ink), so syncing one page never re-uploads a notebook
 *
 * Every sync: pull what changed on Drive -> merge into the local copy -> push local changes.
 * Merges never lose ink (see merge.ts), so two devices can write offline and sync later.
 */

export type SyncStatus =
  | { state: 'not-configured' }
  | { state: 'signed-out' }
  | { state: 'needs-sign-in' }
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'syncing' }
  | { state: 'offline'; lastSyncedAt: number | null }
  | { state: 'error'; message: string; lastSyncedAt: number | null };

interface LibraryFile {
  format: 1;
  items: LibraryItem[];
}

const LIBRARY_FILE = 'library.json';
const PAGE_PREFIX = 'page_';
const AUTO_SYNC_DELAY_MS = 4_000;
const PERIODIC_SYNC_MS = 60_000;

export class SyncEngine {
  private status: SyncStatus;
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedAt: number | null = null;

  constructor(private readonly db: NoteboardDB) {
    this.status = this.restingStatus();
  }

  get current(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private set(status: SyncStatus) {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  private restingStatus(): SyncStatus {
    if (!isConfigured()) return { state: 'not-configured' };
    if (!getToken()) return wasConnected() ? { state: 'needs-sign-in' } : { state: 'signed-out' };
    if (!navigator.onLine) return { state: 'offline', lastSyncedAt: this.lastSyncedAt };
    return { state: 'idle', lastSyncedAt: this.lastSyncedAt };
  }

  /** Starts background syncing: on launch, after edits, periodically, and when coming back online. */
  start(): () => void {
    const onOnline = () => this.syncSoon(0);
    const onVisible = () => document.visibilityState === 'visible' && this.syncSoon(0);
    const onHidden = () => document.visibilityState === 'hidden' && void this.syncNow();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHidden);
    const interval = setInterval(() => this.syncSoon(0), PERIODIC_SYNC_MS);
    this.syncSoon(0);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHidden);
      clearInterval(interval);
    };
  }

  /** Call after any local edit; batches rapid edits into one sync. */
  syncSoon(delay = AUTO_SYNC_DELAY_MS): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  async syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const token = getToken();
    if (!isConfigured() || !token) {
      this.set(this.restingStatus());
      return;
    }
    if (!navigator.onLine) {
      this.set({ state: 'offline', lastSyncedAt: this.lastSyncedAt });
      return;
    }
    this.set({ state: 'syncing' });
    this.running = this.run(new DriveClient(token))
      .then(() => {
        this.lastSyncedAt = Date.now();
        this.set({ state: 'idle', lastSyncedAt: this.lastSyncedAt });
      })
      .catch((error: unknown) => {
        if (error instanceof DriveAuthError) {
          forgetToken();
          this.set({ state: 'needs-sign-in' });
        } else if (!navigator.onLine || error instanceof TypeError) {
          this.set({ state: 'offline', lastSyncedAt: this.lastSyncedAt });
        } else {
          this.set({ state: 'error', message: error instanceof Error ? error.message : String(error), lastSyncedAt: this.lastSyncedAt });
        }
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.syncSoon(0);
        }
      });
    return this.running;
  }

  private async run(drive: DriveClient): Promise<void> {
    const db = this.db;
    let rootId = await db.getMeta<string>('driveRootId');
    if (!rootId) {
      rootId = await drive.ensureRootFolder();
      await db.setMeta('driveRootId', rootId);
    }

    let remoteFiles: DriveFile[];
    try {
      remoteFiles = await drive.listFolder(rootId);
    } catch (error) {
      // The folder may have been deleted by the user; recreate it on the next run.
      await db.setMeta('driveRootId', undefined);
      throw error;
    }
    const remoteByName = new Map(remoteFiles.map((f) => [f.name, f]));

    // 1. Library: pull + merge.
    const libraryRemote = remoteByName.get(LIBRARY_FILE);
    let libraryNeedsPush = !libraryRemote;
    if (libraryRemote) {
      const seen = await db.sync.get(LIBRARY_FILE);
      if (seen?.remoteModified !== libraryRemote.modifiedTime) {
        const remote = await drive.downloadJson<LibraryFile>(libraryRemote.id);
        await db.transaction('rw', db.items, db.pages, async () => {
          const local = await db.items.toArray();
          const result = mergeLibrary(local, remote.items ?? []);
          if (result.localChanged) {
            await db.items.bulkPut(result.merged);
            // Items purged on another device: drop their local pages too.
            for (const item of result.merged) {
              if (item.deleted && item.kind === 'notebook') await db.pages.where('notebookId').equals(item.id).delete();
            }
          }
          if (result.remoteChanged) libraryNeedsPush = true;
        });
        await db.sync.put({ key: LIBRARY_FILE, fileId: libraryRemote.id, remoteModified: libraryRemote.modifiedTime });
      }
    }

    // 2. Pages: pull + merge everything that changed on Drive since we last looked.
    const deletedNotebooks = new Set(
      (await db.items.toArray()).filter((i) => i.kind === 'notebook' && i.deleted).map((i) => i.id),
    );
    for (const file of remoteFiles) {
      if (!file.name.startsWith(PAGE_PREFIX)) continue;
      const notebookId = file.appProperties?.notebookId;
      if (notebookId && deletedNotebooks.has(notebookId)) {
        await drive.trash(file.id);
        await db.sync.delete(file.name);
        continue;
      }
      const seen = await db.sync.get(file.name);
      if (seen?.remoteModified === file.modifiedTime) continue;
      const remote = await drive.downloadJson<Page>(file.id);
      await db.transaction('rw', db.pages, async () => {
        const local = await db.pages.get(remote.id);
        if (!local) {
          await db.pages.put({ ...remote, dirty: 0 });
          return;
        }
        const merged = mergePage(local, remote);
        await db.pages.put({ ...merged, dirty: samePageContent(merged, remote) ? 0 : 1 });
      });
      await db.sync.put({ key: file.name, fileId: file.id, remoteModified: file.modifiedTime });
    }

    // 3. Push the library if it changed locally (revision counter guards against edits mid-upload).
    const rev = (await db.getMeta<number>('libraryRev')) ?? 0;
    const pushedRev = await db.getMeta<number>('libraryPushedRev');
    if (libraryNeedsPush || rev !== pushedRev) {
      const data: LibraryFile = { format: 1, items: await db.items.toArray() };
      const known = await db.sync.get(LIBRARY_FILE);
      const saved = known
        ? await drive.updateJson(known.fileId, data)
        : await drive.createJson(rootId, LIBRARY_FILE, data, { kind: 'library' });
      await db.sync.put({ key: LIBRARY_FILE, fileId: saved.id, remoteModified: saved.modifiedTime });
      await db.setMeta('libraryPushedRev', rev);
    }

    // 4. Push dirty pages.
    const dirty = await db.pages.where('dirty').equals(1).toArray();
    for (const page of dirty) {
      if (deletedNotebooks.has(page.notebookId)) continue;
      const name = `${PAGE_PREFIX}${page.id}.json`;
      const known = await db.sync.get(name);
      const upload: Page = { ...page, dirty: 0 };
      const saved = known
        ? await drive.updateJson(known.fileId, upload)
        : await drive.createJson(rootId, name, upload, { kind: 'page', notebookId: page.notebookId });
      await db.sync.put({ key: name, fileId: saved.id, remoteModified: saved.modifiedTime });
      // Only mark clean if nothing was written to the page while it uploaded.
      await db.pages
        .where('id')
        .equals(page.id)
        .modify((p) => {
          if (p.updatedAt === page.updatedAt) p.dirty = 0;
        });
    }
  }
}
