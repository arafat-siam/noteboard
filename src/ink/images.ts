import { db as defaultDb, type NoteboardDB } from '../db/db';
import { newId, type ID, type Stroke } from '../model/types';
import type { Point } from './geometry';

/**
 * Pictures on pages. The picture itself is an immutable blob in the `files` table (synced to
 * Drive like imported PDFs); the page holds an 'image' stroke whose 4 points are its corners.
 */

/** Big photos are shrunk to this many pixels on the long side (plenty for a note page). */
const MAX_SIDE = 2400;

export const isImageStroke = (s: Pick<Stroke, 'tool'>) => s.tool === 'image';

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif)$/i;

/** True for picture files (iPad sometimes gives dropped photos no type, only a name). */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || (!file.type && IMAGE_NAME.test(file.name));
}

/**
 * Pictures in a drop or paste. Must be called synchronously inside the event handler (the
 * browser empties the data afterwards); links are fetched afterwards by `resolveDropped`.
 */
export function readDropped(dt: DataTransfer | null): { files: File[]; urls: string[] } {
  if (!dt) return { files: [], urls: [] };
  const files: File[] = [...dt.files];
  // Some Safari versions only expose dropped files through `items`.
  for (const item of [...dt.items]) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && !files.some((f) => f.name === file.name && f.size === file.size)) files.push(file);
  }
  const pictures = files.filter(isImageFile);
  const urls: string[] = [];
  if (!pictures.length) {
    // A picture dragged out of a web page arrives as a link (or HTML with an <img>).
    const uri = dt.getData('text/uri-list') || dt.getData('URL');
    for (const line of uri.split(/\r?\n/)) if (line && !line.startsWith('#')) urls.push(line.trim());
    const html = dt.getData('text/html');
    const src = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    if (src) urls.unshift(src);
  }
  return { files: pictures, urls };
}

/** Downloads dropped picture links (works for data: links and sites that allow it). */
export async function resolveDropped(dropped: { files: File[]; urls: string[] }): Promise<Blob[]> {
  if (dropped.files.length) return dropped.files;
  for (const url of dropped.urls) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      if (blob.type.startsWith('image/') || IMAGE_NAME.test(new URL(url, location.href).pathname)) return [blob];
    } catch {
      // The site doesn't allow it; try the next link.
    }
  }
  return [];
}

/**
 * Decodes any picture Safari can show. createImageBitmap is fast but can't read some formats
 * (e.g. HEIC photos from the iPad camera); an <img> element can.
 */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; native: boolean }> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, native: true };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, native: false };
    } finally {
      // Revoked after drawing (below) would be safer for very slow decodes, but decode() has finished.
      URL.revokeObjectURL(url);
    }
  }
}

/** Stores a picture (shrunk if huge) and returns its id and pixel size. */
export async function storeImage(
  blob: Blob,
  name = 'image',
  db: NoteboardDB = defaultDb,
): Promise<{ fileId: ID; width: number; height: number }> {
  const picture = await decode(blob);
  let { width, height } = picture;
  let data: Blob = blob;
  const long = Math.max(width, height);
  // Formats every browser reads are kept as they are; anything else becomes JPEG / PNG.
  const keepAsIs =
    picture.native && long <= MAX_SIDE && blob.size < 3_000_000 && /^image\/(png|jpeg|webp|gif)$/.test(blob.type);
  if (!keepAsIs) {
    const k = Math.min(1, MAX_SIDE / long);
    width = Math.max(1, Math.round(width * k));
    height = Math.max(1, Math.round(height * k));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(picture.source, 0, 0, width, height);
    const png = blob.type === 'image/png';
    data = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image.'))), png ? 'image/png' : 'image/jpeg', 0.88),
    );
  }
  const fileId = newId();
  await db.files.put({
    id: fileId,
    name,
    mime: data.type || 'image/png',
    size: data.size,
    data,
    createdAt: Date.now(),
    uploaded: 0,
  });
  if (picture.source instanceof ImageBitmap) decoded.set(fileId, { bitmap: picture.source, loading: null });
  return { fileId, width: picture.width, height: picture.height };
}

/** A new picture item centred on `center`, at most `maxWidth` × `maxHeight` page units. */
export function makeImageStroke(
  fileId: ID,
  pixelWidth: number,
  pixelHeight: number,
  center: Point,
  maxWidth: number,
  maxHeight: number,
): Stroke {
  // 1 image pixel = 0.75 page unit (a phone photo ends up large; it's then fitted down).
  let w = pixelWidth * 0.75;
  let h = pixelHeight * 0.75;
  const k = Math.min(1, maxWidth / w, maxHeight / h);
  w *= k;
  h *= k;
  const x = center.x - w / 2;
  const y = center.y - h / 2;
  return {
    id: newId(),
    tool: 'image',
    color: '#000000',
    size: 0,
    hasPressure: false,
    points: [x, y, 0, x + w, y, 0, x + w, y + h, 0, x, y + h, 0],
    image: { fileId },
    createdAt: Date.now(),
  };
}

// ---- Decoding (shared by every page and export) ---------------------------------------------

const decoded = new Map<ID, { bitmap: ImageBitmap | null; loading: Promise<ImageBitmap | null> | null }>();
const LOADED = 'noteboard-image-loaded';

/** Decoded picture, or null while it loads (a `noteboard-image-loaded` event follows). */
export function imageFor(fileId: ID, db: NoteboardDB = defaultDb): ImageBitmap | null {
  const entry = decoded.get(fileId);
  if (entry?.bitmap) return entry.bitmap;
  if (!entry) void loadImage(fileId, db);
  return null;
}

/** Loads (once) and decodes a picture. Resolves null if it isn't on this device yet. */
export function loadImage(fileId: ID, db: NoteboardDB = defaultDb): Promise<ImageBitmap | null> {
  const entry = decoded.get(fileId);
  if (entry?.bitmap) return Promise.resolve(entry.bitmap);
  if (entry?.loading) return entry.loading;
  const loading = (async () => {
    const file = await db.files.get(fileId);
    if (!file) {
      decoded.delete(fileId); // try again later (it may still be downloading from Drive)
      return null;
    }
    const bitmap = await createImageBitmap(file.data);
    decoded.set(fileId, { bitmap, loading: null });
    window.dispatchEvent(new CustomEvent(LOADED, { detail: fileId }));
    return bitmap;
  })().catch(() => {
    decoded.delete(fileId);
    return null;
  });
  decoded.set(fileId, { bitmap: null, loading });
  return loading;
}

/** Waits for every picture used by these strokes (before exporting or making thumbnails). */
export async function preloadImages(strokes: Stroke[], db: NoteboardDB = defaultDb): Promise<void> {
  const ids = new Set(strokes.flatMap((s) => (s.image ? [s.image.fileId] : [])));
  await Promise.all([...ids].map((id) => loadImage(id, db)));
}

export function onImageLoaded(handler: (fileId: ID) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ID>).detail);
  window.addEventListener(LOADED, listener);
  return () => window.removeEventListener(LOADED, listener);
}

/** The 4 corners: top-left, top-right, bottom-right, bottom-left. */
export function imageCorners(stroke: Stroke): Point[] {
  const p = stroke.points;
  return [0, 1, 2, 3].map((i) => ({ x: p[i * 3] ?? 0, y: p[i * 3 + 1] ?? 0 }));
}

/** Draws a picture item (a grey box while it loads). */
export function drawImageStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const [tl, tr, , bl] = imageCorners(stroke) as [Point, Point, Point, Point];
  const bitmap = stroke.image ? imageFor(stroke.image.fileId) : null;
  ctx.save();
  if (!bitmap) {
    const [, , br] = imageCorners(stroke) as [Point, Point, Point, Point];
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }
  // Map the bitmap's rectangle onto the (possibly rotated / scaled) corners.
  const w = bitmap.width;
  const h = bitmap.height;
  ctx.transform((tr.x - tl.x) / w, (tr.y - tl.y) / w, (bl.x - tl.x) / h, (bl.y - tl.y) / h, tl.x, tl.y);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
}

/** Picture files used by these strokes. */
export function imageFileIds(strokes: Stroke[]): ID[] {
  return [...new Set(strokes.flatMap((s) => (s.image ? [s.image.fileId] : [])))];
}
