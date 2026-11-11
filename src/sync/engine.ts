import type { NoteboardDB } from '../db/db';
import type { LibraryItem, Page } from '../model/types';
import { DriveAuthError, DriveClient, type DriveFile } from './drive';
import { mergeLibrary, mergePage, samePageContent } from './merge';
import { compactPage } from './compact';
import { loadPage, writePage, removePages } from '../db/pages';
import { clearRemovalQueue, expandLocalOnly, getLocalOnlyRoots, takeRemovalQueue } from './localOnly';
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
  /** The user paused automatic syncing ("Sync now" still works). */
  | { state: 'paused'; lastSyncedAt: number | null }
  | { state: 'syncing' }
  | { state: 'offline'; lastSyncedAt: number | null }
  | { state: 'error'; message: string; lastSyncedAt: number | null };

interface LibraryFile {
  format: 1;
  items: LibraryItem[];
}

const LIBRARY_FILE = 'library.json';
const PAUSED_KEY = 'noteboard.syncPaused';

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}
const PAGE_PREFIX = 'page_';
const FILE_PREFIX = 'file_';
const AUTO_SYNC_DELAY_MS = 4_000;
const PERIODIC_SYNC_MS = 60_000;

export class SyncEngine {
  private status: SyncStatus;
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedAt: number | null = null;
  /** While this returns true (e.g. the user is writing), syncing waits so it never steals frames. */
  private busy: () => boolean = () => false;
  /** Automatic syncing switched off by the user (kept across launches). */
  private paused = readPaused();

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
    if (this.paused) return { state: 'paused', lastSyncedAt: this.lastSyncedAt };
    if (!navigator.onLine) return { state: 'offline', lastSyncedAt: this.lastSyncedAt };
    return { state: 'idle', lastSyncedAt: this.lastSyncedAt };
  }

  /** Starts background syncing: on launch, after edits, periodically, and when coming back online. */
  start(): () => void {
    const onOnline = () => this.syncSoon(0);
    const onVisible = () => document.visibilityState === 'visible' && this.syncSoon(0);
    const onHidden = () => document.visibilityState === 'hidden' && !this.paused && void this.syncNow();
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

  get isPaused(): boolean {
    return this.paused;
  }

  /** Pause or resume automatic syncing. Notes stay safe on this device while paused. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    try {
      localStorage.setItem(PAUSED_KEY, paused ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (paused && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Always notify, so the pause button updates even while a sync is still finishing.
    this.set(this.running ? { ...this.status } : this.restingStatus());
    if (!paused) this.syncSoon(0);
  }

  deferWhile(busy: () => boolean): void {
    this.busy = busy;
  }

  /** Call after any local edit; batches rapid edits into one sync. */
  syncSoon(delay = AUTO_SYNC_DELAY_MS): void {
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.busy()) {
        this.syncSoon(1_500);
        return;
      }
      void this.syncNow();
    }, delay);
  }

  /** Syncs right away. `manual` (the Sync now button) works even while syncing is paused. */
  async syncNow(manual = false): Promise<void> {
    if (this.paused && !manual) {
      this.set(this.restingStatus());
      return;
    }
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
        this.set(this.restingStatus());
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

  /** A sync already running steps aside between files while the Pencil is in use. */
  private async pauseWhileBusy(): Promise<void> {
    while (this.busy()) await new Promise((r) => setTimeout(r, 400));
  }

  private async run(drive: DriveClient): Promise<void> {
    const db = this.db;
    let rootId = await db.getMeta<string>('driveRootId');
    if (!rootId) {
      rootId = await drive.ensureRootFolder();
      await db.setMeta('driveRootId', rootId);
    }

    let remoteFiles: DriveFile[];
    let libraryForcePush = false;
    try {
      remoteFiles = await drive.listFolder(rootId);
    } catch (error) {
      // The folder may have been deleted by the user; recreate it on the next run.
      await db.setMeta('driveRootId', undefined);
      throw error;
    }
    const remoteByName = new Map(remoteFiles.map((f) => [f.name, f]));

    // "Keep on this iPad only": these items (and everything inside them) never leave this device.
    const localOnly = expandLocalOnly(await db.items.toArray(), await getLocalOnlyRoots(db));
    const shared = (i: LibraryItem) => !localOnly.has(i.id);
    const localOnlyNotebooks = [...localOnly];
    const localOnlyFiles = new Set<string>();
    if (localOnlyNotebooks.length) {
      for (const p of await db.pages.where('notebookId').anyOf(localOnlyNotebooks).toArray()) {
        if (p.background) localOnlyFiles.add(p.background.fileId);
      }
    }

    // Items just marked "this iPad only": take their pages and PDFs out of Google Drive.
    const removal = await takeRemovalQueue(db);
    if (removal.length) {
      const inside = expandLocalOnly(await db.items.toArray(), new Set(removal));
      for (const file of remoteFiles) {
        const nb = file.appProperties?.notebookId;
        const pdf = file.appProperties?.fileId;
        const isPage = file.name.startsWith(PAGE_PREFIX) && nb && inside.has(nb);
        const isPdf = file.name.startsWith(FILE_PREFIX) && pdf && localOnlyFiles.has(pdf);
        if (!isPage && !isPdf) continue;
        await drive.trash(file.id);
        await db.sync.delete(isPdf ? `${FILE_PREFIX}${pdf}` : file.name);
      }
      await clearRemovalQueue(db, removal);
      // The library list is re-uploaded below without them.
      libraryForcePush = true;
    }

    // 1. Library: pull + merge.
    const libraryRemote = remoteByName.get(LIBRARY_FILE);
    let libraryNeedsPush = !libraryRemote || libraryForcePush;
    if (libraryRemote) {
      const seen = await db.sync.get(LIBRARY_FILE);
      if (seen?.remoteModified !== libraryRemote.modifiedTime) {
        const remote = await drive.downloadJson<LibraryFile>(libraryRemote.id);
        await db.transaction('rw', db.items, db.pages, db.strokes, async () => {
          // Local-only items are neither sent nor overwritten by what's in Drive.
          const local = (await db.items.toArray()).filter(shared);
          const result = mergeLibrary(local, (remote.items ?? []).filter(shared));
          if (result.localChanged) {
            await db.items.bulkPut(result.merged);
            // Items purged on another device: drop their local pages too.
            for (const item of result.merged) {
              if (item.deleted && item.kind === 'notebook') {
                await removePages(db, (await db.pages.where('notebookId').equals(item.id).primaryKeys()) as string[]);
              }
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
      if (notebookId && localOnly.has(notebookId)) continue;
      if (notebookId && deletedNotebooks.has(notebookId)) {
        await drive.trash(file.id);
        await db.sync.delete(file.name);
        continue;
      }
      const seen = await db.sync.get(file.name);
      if (seen?.remoteModified === file.modifiedTime) continue;
      await this.pauseWhileBusy();
      const remote = await drive.downloadJson<Page>(file.id);
      await db.transaction('rw', db.pages, db.strokes, async () => {
        const local = await loadPage(db, remote.id);
        if (!local) {
          await writePage(db, { ...remote, dirty: 0 });
          return;
        }
        const merged = mergePage(local, remote);
        await writePage(db, { ...merged, dirty: samePageContent(merged, remote) ? 0 : 1 });
      });
      await db.sync.put({ key: file.name, fileId: file.id, remoteModified: file.modifiedTime });
    }

    // 3. Push the library if it changed locally (revision counter guards against edits mid-upload).
    const rev = (await db.getMeta<number>('libraryRev')) ?? 0;
    const pushedRev = await db.getMeta<number>('libraryPushedRev');
    if (libraryNeedsPush || rev !== pushedRev) {
      await this.pauseWhileBusy();
      const data: LibraryFile = { format: 1, items: (await db.items.toArray()).filter(shared) };
      const known = await db.sync.get(LIBRARY_FILE);
      const saved = known
        ? await drive.updateJson(known.fileId, data)
        : await drive.createJson(rootId, LIBRARY_FILE, data, { kind: 'library' });
      await db.sync.put({ key: LIBRARY_FILE, fileId: saved.id, remoteModified: saved.modifiedTime });
      await db.setMeta('libraryPushedRev', rev);
    }

    // 3b. Imported PDFs: upload new ones (before the pages that use them), download missing ones.
    const localFiles = new Set((await db.files.toCollection().primaryKeys()) as string[]);
    for (const file of await db.files.where('uploaded').equals(0).toArray()) {
      if (localOnlyFiles.has(file.id)) continue;
      const saved = await drive.createBinary(rootId, `${FILE_PREFIX}${file.id}.pdf`, file.data, file.mime, {
        kind: 'file',
        fileId: file.id,
        name: file.name.slice(0, 100),
      });
      await db.sync.put({ key: `${FILE_PREFIX}${file.id}`, fileId: saved.id, remoteModified: saved.modifiedTime });
      await db.files.update(file.id, { uploaded: 1 });
    }
    for (const remote of remoteFiles) {
      const fileId = remote.appProperties?.fileId;
      if (!remote.name.startsWith(FILE_PREFIX) || !fileId || localFiles.has(fileId)) continue;
      const data = await drive.downloadBlob(remote.id);
      await db.files.put({
        id: fileId,
        name: remote.appProperties?.name ?? remote.name,
        mime: data.type || 'application/pdf',
        size: data.size,
        data,
        createdAt: Date.now(),
        uploaded: 1,
      });
      await db.sync.put({ key: `${FILE_PREFIX}${fileId}`, fileId: remote.id, remoteModified: remote.modifiedTime });
    }

    // 4. Push dirty pages.
    const dirty = await db.pages.where('dirty').equals(1).toArray();
    for (const record of dirty) {
      if (deletedNotebooks.has(record.notebookId) || localOnly.has(record.notebookId)) continue;
      await this.pauseWhileBusy();
      const page = await loadPage(db, record.id);
      if (!page) continue;
      const name = `${PAGE_PREFIX}${page.id}.json`;
      const known = await db.sync.get(name);
      // Older pages get compacted on their next upload.
      const upload: Page = { ...compactPage(page), dirty: 0 };
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
