import type { Page, Stroke } from '../model/types';

/**
 * Storage format helpers.
 *
 * Ink coordinates are kept to 0.01 page units (far below anything visible) and pressure to
 * 0.001; full double precision made pages ~2.7× larger for no benefit. Files in Google Drive
 * are additionally gzip-compressed. Old uncompressed files are still read correctly.
 */

const round = (v: number, f: number) => Math.round(v * f) / f;

export function compactPoints(points: number[]): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) out[i] = i % 3 === 2 ? round(points[i]!, 1000) : round(points[i]!, 100);
  return out;
}

export function compactStroke(stroke: Stroke): Stroke {
  return { ...stroke, points: compactPoints(stroke.points), size: round(stroke.size, 1000) };
}

export function compactPage(page: Page): Page {
  return { ...page, strokes: page.strokes.map(compactStroke) };
}

/** gzip-compressed JSON (Safari 16.4+ and Node 18+ have CompressionStream). */
export async function gzipJson(data: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

/** Reads JSON that may or may not be gzip-compressed (older files aren't). */
export async function readJson<T>(bytes: ArrayBuffer): Promise<T> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text()) as T;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
