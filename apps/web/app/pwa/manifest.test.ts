import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

const publicDir = path.resolve(__dirname, '../../public');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  lang: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons: ManifestIcon[] }[];
}

function readPublic(file: string): Buffer {
  return readFileSync(path.join(publicDir, file));
}

const manifest = JSON.parse(readPublic('manifest.webmanifest').toString('utf8')) as Manifest;

function pngSize(file: string): string {
  const png = readPublic(file);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

describe('web app manifest', () => {
  it('opens the app shell as a standalone Russian-language app', () => {
    expect(manifest).toMatchObject({
      name: 'HarmoFin — семейный бюджет',
      short_name: 'HarmoFin',
      lang: 'ru',
      id: '/app',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      theme_color: '#F7F9FA',
      background_color: '#F7F9FA',
    });
  });

  it('ships 192, 512 and maskable 512 PNG icons whose files match their declared size', () => {
    const declared = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose ?? 'any'}`);
    expect(declared).toEqual(
      expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']),
    );
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(pngSize(icon.src)).toBe(icon.sizes);
    }
    expect(pngSize('/icons/apple-touch-icon.png')).toBe('180x180');
  });

  it('offers a home-screen shortcut straight to the quick expense entry', () => {
    expect(manifest.shortcuts).toEqual([
      expect.objectContaining({ name: 'Добавить расход', url: '/app?entry=expense' }),
    ]);
    for (const icon of manifest.shortcuts[0]?.icons ?? []) {
      expect(pngSize(icon.src)).toBe(icon.sizes);
    }
  });

  it('keeps the three-part maskable mark within the platform safe circle', () => {
    const png = readPublic('/icons/icon-maskable-512.png');
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        chunks.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const rows = inflateSync(Buffer.concat(chunks));
    const stride = 512 * 4 + 1;
    let foreground = 0;
    let opaque = true;
    let maxRadius = 0;
    for (let y = 0; y < 512; y++) {
      expect(rows[y * stride]).toBe(0);
      for (let x = 0; x < 512; x++) {
        const i = y * stride + 1 + x * 4;
        opaque &&= rows[i + 3] === 255;
        if (rows[i] === 13 && rows[i + 1] === 27 && rows[i + 2] === 42) continue;
        foreground++;
        maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - 256, y + 0.5 - 256));
      }
    }
    expect(foreground).toBeGreaterThan(20000);
    expect(opaque).toBe(true);
    expect(maxRadius).toBeLessThan(512 * 0.4);
  });
});

describe('offline fallback page', () => {
  const html = readPublic('offline.html').toString('utf8');

  it('explains the missing connection in Russian and offers a retry', () => {
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('Нет подключения к интернету');
    expect(html).toContain('Повторить');
  });

  it('is self-contained so it renders from the cache without the network', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
