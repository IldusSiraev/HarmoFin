// Dependency-free rasterizer for the approved three-part brand mark.
// Regenerate with: node apps/web/scripts/generate-pwa-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
const OUTPUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));
const source = readFileSync(new URL('../public/brand/mark.svg', import.meta.url), 'utf8');
const colors = [
  [255, 255, 255],
  [27, 163, 156],
  [115, 198, 182],
];
const navy = [13, 27, 42];
const SAMPLES = 4;
const ICONS = [
  { file: 'icon-192.png', size: 192, fullBleed: false },
  { file: 'icon-512.png', size: 512, fullBleed: false },
  { file: 'icon-maskable-512.png', size: 512, fullBleed: true },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true },
];
// Flatten the master's M/L/H/V/C/Z contours, then supersample scanlines.
function polygon(d) {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+/g);
  let i = 0,
    x = 0,
    y = 0;
  const points = [];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      x = num();
      y = num();
      points.push([x, y]);
    } else if (cmd === 'H') {
      x = num();
      points.push([x, y]);
    } else if (cmd === 'V') {
      y = num();
      points.push([x, y]);
    } else if (cmd === 'C') {
      const ax = x,
        ay = y,
        bx = num(),
        by = num(),
        cx = num(),
        cy = num(),
        dx = num(),
        dy = num();
      for (let k = 1; k <= 32; k++) {
        const t = k / 32,
          u = 1 - t;
        points.push([
          u * u * u * ax + 3 * u * u * t * bx + 3 * u * t * t * cx + t * t * t * dx,
          u * u * u * ay + 3 * u * u * t * by + 3 * u * t * t * cy + t * t * t * dy,
        ]);
      }
      x = dx;
      y = dy;
    } else if (cmd !== 'Z') throw new Error('Unsupported master path command: ' + cmd);
  }
  return points;
}
const polygons = [...source.matchAll(/ d="([^"]+)"/g)].map((m) => polygon(m[1]));
if (polygons.length !== 3) throw new Error('Expected three brand parts');
function renderPixels({ size, fullBleed }) {
  const side = size * SAMPLES,
    pixels = Buffer.alloc(size * size * 4),
    sums = new Uint32Array(size * size * 4);
  // The maskable mark fits in a 70%-wide square, wholly inside the 80% safe circle.
  const scale = fullBleed ? 0.7 : 0.8;
  for (let sy = 0; sy < side; sy++) {
    const row = new Uint8Array(side),
      y = 128 + (((sy + 0.5) / side) * 256 - 128) / scale;
    polygons.forEach((poly, index) => {
      const xs = [];
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j],
          b = poly[(j + 1) % poly.length];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let j = 0; j < xs.length; j += 2) {
        const start = Math.ceil((((xs[j] - 128) * scale + 128) / 256) * side - 0.5),
          end = Math.ceil((((xs[j + 1] - 128) * scale + 128) / 256) * side - 0.5);
        row.fill(index + 1, Math.max(0, start), Math.min(side, end));
      }
    });
    for (let sx = 0; sx < side; sx++) {
      const x = ((sx + 0.5) / side) * 256,
        yy = ((sy + 0.5) / side) * 256;
      const cx = Math.min(Math.max(x, 56), 200),
        cy = Math.min(Math.max(yy, 56), 200);
      if (!fullBleed && Math.hypot(x - cx, yy - cy) > 56) continue;
      const color = row[sx] ? colors[row[sx] - 1] : navy;
      const offset = (Math.floor(sy / SAMPLES) * size + Math.floor(sx / SAMPLES)) * 4;
      for (let c = 0; c < 3; c++) sums[offset + c] += color[c];
      sums[offset + 3]++;
    }
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const n = sums[i + 3];
    for (let c = 0; c < 3; c++) pixels[i + c] = n ? Math.round(sums[i + c] / n) : 0;
    pixels[i + 3] = Math.round((n / (SAMPLES * SAMPLES)) * 255);
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

writeFileSync(
  new URL('../public/favicon.svg', import.meta.url),
  source
    .replace('fill="#0D1B2A"', 'fill="#FFFFFF"')
    .replace(/(<svg[^>]*>)/, '$1<rect width="256" height="256" rx="56" fill="#0D1B2A"/>'),
);
