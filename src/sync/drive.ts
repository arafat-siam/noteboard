/** Minimal Google Drive v3 REST client (fetch only, no Google SDK). */
import { gzipJson, readJson } from './compact';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
}

export interface DriveAbout {
  name: string;
  email: string;
  photo: string;
  driveUsed: number;
  driveLimit: number | null;
}

export class DriveAuthError extends Error {}
export class DriveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,modifiedTime,appProperties';
const ROOT_FOLDER_NAME = 'Noteboard';

/** Reads a publicly shared file without signing in (needs the app's public API key). */
export async function downloadPublic(fileId: string, apiKey: string): Promise<Uint8Array> {
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new DriveError(res.status === 404 ? 'This link no longer works. The owner may have stopped sharing it.' : `Could not open the shared notes (error ${res.status}).`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

export class DriveClient {
  constructor(private readonly token: string) {}

  private async request(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    if (response.status === 401) throw new DriveAuthError('Google sign-in expired.');
    // Rate limits and transient server errors: back off and retry.
    if ((response.status === 429 || response.status >= 500 || response.status === 403) && attempt < 4) {
      const body = response.status === 403 ? await response.clone().text() : '';
      if (response.status !== 403 || /rateLimit|userRateLimit/i.test(body)) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
        return this.request(url, init, attempt + 1);
      }
    }
    if (!response.ok) {
      throw new DriveError(`Google Drive error ${response.status}: ${(await response.text()).slice(0, 200)}`, response.status);
    }
    return response;
  }

  /** Finds (or creates) the visible "Noteboard" folder in the user's Drive. */
  async ensureRootFolder(): Promise<string> {
    const q = "mimeType='application/vnd.google-apps.folder' and appProperties has { key='noteboardRoot' and value='1' } and trashed=false";
    const found = await this.request(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    const files = ((await found.json()) as { files: { id: string }[] }).files;
    if (files[0]) return files[0].id;
    const created = await this.request(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { noteboardRoot: '1' },
      }),
    });
    return ((await created.json()) as { id: string }).id;
  }

  async listFolder(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${API}/files?${params}`);
      const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      files.push(...body.files);
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  /** Reads a Noteboard data file (gzip-compressed, or plain JSON for files from older versions). */
  async downloadJson<T>(fileId: string): Promise<T> {
    const res = await this.request(`${API}/files/${fileId}?alt=media`);
    return readJson<T>(await res.arrayBuffer());
  }

  /** Data files are stored gzip-compressed (several times smaller than plain JSON). */
  async createJson(folderId: string, name: string, data: unknown, appProperties: Record<string, string>): Promise<DriveFile> {
    return this.createBinary(folderId, name, await gzipJson(data), 'application/gzip', { ...appProperties, enc: 'gzip' });
  }

  async updateJson(fileId: string, data: unknown): Promise<DriveFile> {
    const res = await this.request(`${UPLOAD}/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/gzip' },
      body: await gzipJson(data),
    });
    return (await res.json()) as DriveFile;
  }

  /** Uploads a binary file (e.g. an imported PDF). */
  async createBinary(
    folderId: string,
    name: string,
    data: Blob,
    mime: string,
    appProperties: Record<string, string>,
  ): Promise<DriveFile> {
    const boundary = `noteboard-${crypto.randomUUID()}`;
    const metadata = { name, parents: [folderId], mimeType: mime, appProperties };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as DriveFile;
  }

  async downloadBlob(fileId: string): Promise<Blob> {
    const res = await this.request(`${API}/files/${fileId}?alt=media`);
    return res.blob();
  }

  /** Bookmark for "what changed since now" (Drive changes API). */
  async startPageToken(): Promise<string> {
    const res = await this.request(`${API}/changes/startPageToken`);
    return ((await res.json()) as { startPageToken: string }).startPageToken;
  }

  /**
   * Files changed since `token` (only files this app can see, i.e. Noteboard's own) and the
   * bookmark to use next time. One small request when nothing changed, instead of listing the
   * whole Noteboard folder.
   */
  async changesSince(token: string): Promise<{ files: (DriveFile & { parents?: string[]; trashed?: boolean })[]; removed: number; next: string }> {
    const files: (DriveFile & { parents?: string[]; trashed?: boolean })[] = [];
    let removed = 0;
    let pageToken: string | undefined = token;
    let next = token;
    while (pageToken) {
      const params = new URLSearchParams({
        pageToken,
        pageSize: '1000',
        spaces: 'drive',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS},parents,trashed))`,
      });
      const res = await this.request(`${API}/changes?${params}`);
      const body = (await res.json()) as {
        nextPageToken?: string;
        newStartPageToken?: string;
        changes: { fileId: string; removed?: boolean; file?: DriveFile & { parents?: string[]; trashed?: boolean } }[];
      };
      for (const c of body.changes ?? []) {
        if (c.removed || !c.file) removed++;
        else files.push(c.file);
      }
      pageToken = body.nextPageToken;
      if (body.newStartPageToken) next = body.newStartPageToken;
    }
    return { files, removed, next };
  }

  /** Finds (or creates) the top-level "Noteboard shared links" folder (copies made for sharing). */
  async ensureSharesFolder(): Promise<string> {
    const q = "mimeType='application/vnd.google-apps.folder' and appProperties has { key='noteboardShares' and value='1' } and trashed=false";
    const found = await this.request(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    const files = ((await found.json()) as { files: { id: string }[] }).files;
    if (files[0]) return files[0].id;
    const created = await this.request(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Noteboard shared links', mimeType: 'application/vnd.google-apps.folder', appProperties: { noteboardShares: '1' } }),
    });
    return ((await created.json()) as { id: string }).id;
  }

  /** Anyone with the link can view this file (no Google account needed). */
  async makePublic(fileId: string): Promise<void> {
    await this.request(`${API}/files/${fileId}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  /** Deletes a file for good (used for shared copies: the link stops working at once). */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.request(`${API}/files/${fileId}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof DriveError && error.status === 404)) throw error;
    }
  }

  /** Moves a file to the Drive trash (recoverable by the user for 30 days). */
  async trash(fileId: string): Promise<void> {
    await this.request(`${API}/files/${fileId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  /**
   * Reads the text in a picture of handwriting with Google Drive's own text recognition: the
   * image is uploaded as a Google Doc (Drive converts it, reading the text), the text is
   * exported, and the temporary document is deleted straight away.
   */
  async readTextFromImage(image: Blob, language: string): Promise<string> {
    const boundary = `noteboard-${crypto.randomUUID()}`;
    // Outside the Noteboard folder, so the sync quick check isn't woken up by it.
    const metadata = { name: 'Noteboard text recognition (temporary)', mimeType: 'application/vnd.google-apps.document' };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${image.type || 'image/jpeg'}\r\n\r\n`,
      image,
      `\r\n--${boundary}--`,
    ]);
    const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id', ocrLanguage: language });
    const res = await this.request(`${UPLOAD}/files?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const { id } = (await res.json()) as { id: string };
    try {
      const text = await this.request(`${API}/files/${id}/export?mimeType=text%2Fplain`);
      // Google Docs exports start with a byte-order mark.
      return (await text.text()).replace(/^﻿/, '').trim();
    } finally {
      await this.deleteFile(id).catch(() => undefined);
    }
  }

  /** The signed-in Google account and the Drive's total storage (works with the drive.file scope). */
  async about(): Promise<DriveAbout> {
    const fields = 'user(displayName,emailAddress,photoLink),storageQuota(limit,usage)';
    const res = await this.request(`${API}/about?fields=${encodeURIComponent(fields)}`);
    const body = (await res.json()) as {
      user?: { displayName?: string; emailAddress?: string; photoLink?: string };
      storageQuota?: { limit?: string; usage?: string };
    };
    return {
      name: body.user?.displayName ?? '',
      email: body.user?.emailAddress ?? '',
      photo: body.user?.photoLink ?? '',
      driveUsed: Number(body.storageQuota?.usage ?? 0),
      // No limit = unlimited (some Workspace accounts).
      driveLimit: body.storageQuota?.limit ? Number(body.storageQuota.limit) : null,
    };
  }

  /** Bytes used by every file Noteboard created in this Drive (the drive.file scope sees only those). */
  async appUsage(): Promise<number> {
    let total = 0;
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: 'trashed=false', fields: 'nextPageToken,files(size)', pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${API}/files?${params}`);
      const body = (await res.json()) as { files: { size?: string }[]; nextPageToken?: string };
      for (const f of body.files) total += Number(f.size ?? 0);
      pageToken = body.nextPageToken;
    } while (pageToken);
    return total;
  }
}
