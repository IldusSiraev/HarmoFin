// Renders the HarmoFin "H" favicon glyph into the PNG icons the web app
// manifest needs. Dependency-free on purpose (node:zlib only) so the icons can
// be regenerated without adding an image toolchain:
//   node apps/web/scripts/generate-pwa-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OUTPUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));
const BRAND = [0x1b, 0xa3, 0x9c];
const GLYPH = [0xff, 0xff, 0xff];
const SAMPLES = 4;

// Same geometry as public/favicon.svg, on its 32-unit grid.
const CORNER_RADIUS = 8;
const STROKE_HALF_WIDTH = 1.5;
const SEGMENTS = [
  [10, 8, 10, 24],
  [22, 8, 22, 24],
  [10, 16, 22, 16],
];

const ICONS = [
  { file: 'icon-192.png', size: 192, fullBleed: false },
  { file: 'icon-512.png', size: 512, fullBleed: false },
  // Maskable and Apple icons get cropped by the platform: fill to the edges
  // and shrink the glyph so it stays inside the 80 % safe zone.
  { file: 'icon-maskable-512.png', size: 512, fullBleed: true },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true },
];

function distanceToSegment(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function insideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, CORNER_RADIUS), 32 - CORNER_RADIUS);
  const cy = Math.min(Math.max(y, CORNER_RADIUS), 32 - CORNER_RADIUS);
  return x >= 0 && x <= 32 && y >= 0 && y <= 32 && Math.hypot(x - cx, y - cy) <= CORNER_RADIUS;
}

function insideGlyph(x, y, scale) {
  const gx = 16 + (x - 16) / scale;
  const gy = 16 + (y - 16) / scale;
  return SEGMENTS.some((segment) => distanceToSegment(gx, gy, segment) <= STROKE_HALF_WIDTH);
}

function renderPixels({ size, fullBleed }) {
  const scale = fullBleed ? 0.8 : 1;
  const pixels = Buffer.alloc(size * size * 4);
  const total = SAMPLES * SAMPLES;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0;
      let glyph = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 32;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 32;
          if (!fullBleed && !insideRoundedSquare(x, y)) continue;
          if (insideGlyph(x, y, scale)) glyph += 1;
          else background += 1;
        }
      }
      const covered = background + glyph;
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = covered
          ? Math.round((BRAND[channel] * background + GLYPH[channel] * glyph) / covered)
          : 0;
      }
      pixels[offset + 3] = Math.round((covered / total) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row += 1) {
    // Filter byte 0 (none) followed by the row's RGBA bytes.
    pixels.copy(rows, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const icon of ICONS) {
  writeFileSync(join(OUTPUT_DIR, icon.file), encodePng(icon.size, renderPixels(icon)));
  console.log(`wrote ${icon.file} (${icon.size}x${icon.size})`);
}
