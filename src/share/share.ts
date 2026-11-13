import type { NoteboardDB } from '../db/db';
import { notebookPages } from '../db/pages';
import type { ID, LibraryItem, Notebook, Page } from '../model/types';
import { compactPage, gzipJson, readJson } from '../sync/compact';
import { DriveClient } from '../sync/drive';
import { fromBase64, seal, toBase64, unseal } from './seal';

/**
 * Sharing by link (a read-only snapshot, like "Anyone with the link can view").
 *
 * A copy of the notebook (or of every notebook in a folder) is uploaded to a separate
 * "Noteboard shared links" folder in the owner's Google Drive and made viewable by anyone with
 * the link. The link opens Noteboard's viewer, which reads it without any sign-in.
 *
 * Locked notebooks stay locked: their pages and files are encrypted with the notebook passcode
 * (see seal.ts) before they leave the device, so the shared file is unreadable without it.
 */

export interface NotebookContent {
  pages: Page[];
  /** Pictures and PDFs used by the pages: local file id -> Drive copy. */
  assets: Record<ID, { driveId: string; mime: string }>;
}

export type SharedNotebook = {
  id: ID;
  name: string;
  coverColor: string;
  /** Folder path inside a shared folder ("" for the folder itself). */
  path: string;
} & ({ locked: false; content: NotebookContent } | { locked: true; sealed: string });

export interface ShareManifest {
  app: 'noteboard-share';
  format: 1;
  kind: 'notebook' | 'folder';
  name: string;
  sharedAt: number;
  notebooks: SharedNotebook[];
}

/** A share made from this device (kept so it can be stopped later). */
export interface ShareRecord {
  itemId: ID;
  name: string;
  kind: 'notebook' | 'folder';
  manifestId: string;
  /** Every Drive file belonging to the share (manifest + copies of pictures / PDFs). */
  driveIds: string[];
  createdAt: number;
  link: string;
}

const SHARES_KEY = 'shares';

export async function listShares(db: NoteboardDB): Promise<ShareRecord[]> {
  return (await db.getMeta<ShareRecord[]>(SHARES_KEY)) ?? [];
}

export function shareLink(manifestId: string): string {
  const origin = typeof location === 'undefined' ? 'https://arafat-siam.github.io' : location.origin;
  return `${origin}${import.meta.env.BASE_URL}#/s/${manifestId}`;
}

/** Notebooks to include: the notebook itself, or everything inside a folder (with their paths). */
function notebooksIn(items: LibraryItem[], root: LibraryItem): { notebook: Notebook; path: string }[] {
  if (root.kind === 'notebook') return [{ notebook: root, path: '' }];
  const alive = items.filter((i) => !i.deleted && !i.trashedAt);
  const out: { notebook: Notebook; path: string }[] = [];
  const walk = (folderId: ID, path: string) => {
    for (const item of alive.filter((i) => i.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (item.kind === 'notebook') out.push({ notebook: item, path });
      else walk(item.id, path ? `${path} / ${item.name}` : item.name);
    }
  };
  walk(root.id, '');
  return out;
}

/** Locked notebooks in what would be shared (their passcodes are needed to share them). */
export async function lockedNotebooksIn(db: NoteboardDB, itemId: ID): Promise<Notebook[]> {
  const items = await db.items.toArray();
  const root = items.find((i) => i.id === itemId);
  return root ? notebooksIn(items, root).map((n) => n.notebook).filter((n) => !!n.lock) : [];
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * Uploads a snapshot and returns its record (with the link). `passcodes`: notebook id -> its
 * passcode, for every locked notebook in the share.
 */
export async function createShare(
  db: NoteboardDB,
  drive: DriveClient,
  itemId: ID,
  passcodes: Map<ID, string>,
  onProgress?: (text: string) => void,
): Promise<ShareRecord> {
  const items = await db.items.toArray();
  const root = items.find((i) => i.id === itemId);
  if (!root || root.deleted) throw new Error('This item no longer exists.');
  const folderId = await drive.ensureSharesFolder();
  const driveIds: string[] = [];
  const upload = async (name: string, data: Blob | Uint8Array, mime: string) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const file = await drive.createBinary(folderId, name, blob, mime, { kind: 'share' });
    driveIds.push(file.id);
    await drive.makePublic(file.id);
    return file.id;
  };

  try {
    const notebooks: SharedNotebook[] = [];
    const list = notebooksIn(items, root);
    for (const [index, { notebook, path }] of list.entries()) {
      onProgress?.(`Preparing ${notebook.name} (${index + 1} of ${list.length})`);
      const passcode = notebook.lock ? passcodes.get(notebook.id) : undefined;
      if (notebook.lock && !passcode) throw new Error(`The passcode of “${notebook.name}” is needed to share it.`);
      const pages = (await notebookPages(db, notebook.id)).map((p) => ({ ...compactPage(p), dirty: 0 as const }));
      const assetIds = new Set<ID>();
      for (const p of pages) {
        if (p.background) assetIds.add(p.background.fileId);
        for (const s of p.strokes) if (s.image) assetIds.add(s.image.fileId);
      }
      const assets: NotebookContent['assets'] = {};
      for (const fileId of assetIds) {
        const file = await db.files.get(fileId);
        if (!file) continue; // not downloaded on this device: the viewer shows a placeholder
        const raw = await bytesOf(file.data);
        const data = passcode ? await seal(raw, passcode) : raw;
        assets[fileId] = { driveId: await upload(`asset_${fileId}`, data, passcode ? 'application/octet-stream' : file.mime), mime: file.mime };
      }
      const content: NotebookContent = { pages, assets };
      const base = { id: notebook.id, name: notebook.name, coverColor: notebook.coverColor, path };
      if (passcode) {
        const packed = await bytesOf(await gzipJson(content));
        notebooks.push({ ...base, locked: true, sealed: toBase64(await seal(packed, passcode)) });
      } else {
        notebooks.push({ ...base, locked: false, content });
      }
    }
    onProgress?.('Creating the link');
    const manifest: ShareManifest = { app: 'noteboard-share', format: 1, kind: root.kind, name: root.name, sharedAt: Date.now(), notebooks };
    const manifestId = await upload(`share_${root.id}.json.gz`, await gzipJson(manifest), 'application/gzip');
    const record: ShareRecord = { itemId, name: root.name, kind: root.kind, manifestId, driveIds, createdAt: Date.now(), link: shareLink(manifestId) };
    await db.setMeta(SHARES_KEY, [...(await listShares(db)), record]);
    return record;
  } catch (error) {
    // Don't leave half a share public.
    for (const id of driveIds) await drive.deleteFile(id).catch(() => undefined);
    throw error;
  }
}

/** Stops a share: its files are deleted from Drive, so the link stops working at once. */
export async function stopShare(db: NoteboardDB, drive: DriveClient, manifestId: string): Promise<void> {
  const shares = await listShares(db);
  const record = shares.find((s) => s.manifestId === manifestId);
  for (const id of record?.driveIds ?? [manifestId]) await drive.deleteFile(id);
  await db.setMeta(
    SHARES_KEY,
    shares.filter((s) => s.manifestId !== manifestId),
  );
}

// ---- Viewer side ---------------------------------------------------------------------------

export async function readManifest(bytes: Uint8Array): Promise<ShareManifest> {
  const manifest = await readJson<ShareManifest>(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (manifest?.app !== 'noteboard-share' || !Array.isArray(manifest.notebooks)) throw new Error('This is not a Noteboard shared link.');
  return manifest;
}

/** Opens a locked notebook of a share (throws WrongPasscodeError for a wrong passcode). */
export async function openLocked(entry: SharedNotebook & { locked: true }, passcode: string): Promise<NotebookContent> {
  const packed = await unseal(fromBase64(entry.sealed), passcode);
  return readJson<NotebookContent>(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer);
}
