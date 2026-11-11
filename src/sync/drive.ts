/** Minimal Google Drive v3 REST client (fetch only, no Google SDK). */

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
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

  async downloadJson<T>(fileId: string): Promise<T> {
    const res = await this.request(`${API}/files/${fileId}?alt=media`);
    return (await res.json()) as T;
  }

  async createJson(folderId: string, name: string, data: unknown, appProperties: Record<string, string>): Promise<DriveFile> {
    const boundary = `noteboard-${crypto.randomUUID()}`;
    const metadata = { name, parents: [folderId], mimeType: 'application/json', appProperties };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as DriveFile;
  }

  async updateJson(fileId: string, data: unknown): Promise<DriveFile> {
    const res = await this.request(`${UPLOAD}/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
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

  /** Moves a file to the Drive trash (recoverable by the user for 30 days). */
  async trash(fileId: string): Promise<void> {
    await this.request(`${API}/files/${fileId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }
}
