import Dexie, { type Table } from 'dexie';
import type { LibraryItem, Page } from '../model/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** Remembers which Google Drive file backs a local record and the version last seen. */
export interface SyncRow {
  key: string;
  fileId: string;
  remoteModified: string;
}

/** Local working copy (IndexedDB). Google Drive is the durable copy shared across devices. */
export class NoteboardDB extends Dexie {
  items!: Table<LibraryItem, string>;
  pages!: Table<Page, string>;
  meta!: Table<MetaRow, string>;
  sync!: Table<SyncRow, string>;

  constructor(name = 'noteboard') {
    super(name);
    this.version(1).stores({
      items: 'id, kind',
      pages: 'id, notebookId, dirty',
      meta: 'key',
      sync: 'key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const db = new NoteboardDB();
