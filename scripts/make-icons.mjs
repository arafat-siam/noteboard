// Generates the app icons (PNG) without any image tooling: draws pixels and encodes PNG with zlib.
// Run: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Blue gradient tile, white page, dark ink swoosh.
function icon(u, v) {
  const top = [62, 128, 240];
  const bottom = [36, 86, 200];
  let c = top.map((t, i) => Math.round(t + (bottom[i] - t) * v));
  const inPage = u > 0.24 && u < 0.76 && v > 0.17 && v < 0.83;
  if (inPage) {
    c = [255, 255, 255];
    for (const ly of [0.36, 0.48, 0.6, 0.72]) if (Math.abs(v - ly) < 0.006 && u > 0.3 && u < 0.7) c = [169, 196, 223];
    const d = Math.min(
      distToSegment(u, v, 0.32, 0.62, 0.42, 0.34),
      distToSegment(u, v, 0.42, 0.34, 0.52, 0.6),
      distToSegment(u, v, 0.52, 0.6, 0.66, 0.3),
    );
    if (d < 0.025) c = [28, 28, 30];
  }
  return [...c, 255];
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-512.png', png(512, icon));
writeFileSync('public/icon-192.png', png(192, icon));
writeFileSync('public/apple-touch-icon.png', png(180, icon));
writeFileSync(
  'public/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3e80f0"/><stop offset="1" stop-color="#2456c8"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#g)"/><rect x="24" y="17" width="52" height="66" rx="3" fill="#fff"/><path d="M32 62 42 34 52 60 66 30" fill="none" stroke="#1c1c1e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);
console.log('Icons written to public/');
