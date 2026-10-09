import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Note: resolved via fileURLToPath(import.meta.url) + path.join rather than
// `new URL('./x', import.meta.url)` because the happy-dom test environment
// replaces the global URL implementation, which also leaks into the `URL`
// export of `node:url` and breaks file:// base resolution.
const currentDir = dirname(fileURLToPath(import.meta.url));
const tokensPath = join(currentDir, 'tokens.css');
const appDir = join(currentDir, '../../');
const tokens = readFileSync(tokensPath, 'utf8');

const requiredTokens = [
  ['--hf-color-brand', '#1ba39c'],
  ['--hf-color-brand-hover', '#168f89'],
  ['--hf-color-brand-bright', '#3fc2ba'],
  ['--hf-color-brand-soft', '#e3f5f3'],
  ['--hf-color-primary-bright', '#73c6b6'],
  ['--hf-color-primary-strong', '#2c5b8a'],
  ['--hf-color-danger-strong', '#d14343'],
  ['--hf-color-status-danger-bright', '#e15c5c'],
  ['--hf-color-status-warning-bright', '#f5a524'],
  ['--hf-color-slate-900', '#0d1b2a'],
  ['--hf-color-slate-500', '#5b6b78'],
  ['--hf-color-slate-50', '#f7f9fa'],
  ['--hf-color-surface', '#ffffff'],
];

const legacyTokens = [
  '--hf-color-brand-teal',
  '--hf-color-brand-navy',
  '--hf-color-brand-mint',
  '--hf-color-brand-green',
  '--hf-color-brand-blue',
  '--hf-color-teal-700',
  '--hf-color-teal-800',
  '--hf-color-teal-900',
];

function collectFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full, extensions);
    return extensions.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

describe('design tokens', () => {
  it.each(requiredTokens)('defines %s as %s', (name, value) => {
    expect(tokens.toLowerCase()).toContain(`${name}: ${value};`);
  });

  it('defines the kit radius scale', () => {
    expect(tokens).toContain('--hf-radius-sm: 0.375rem;');
    expect(tokens).toContain('--hf-radius-md: 0.625rem;');
    expect(tokens).toContain('--hf-radius-lg: 1rem;');
    expect(tokens).toContain('--hf-radius-xl: 1.25rem;');
  });

  it('defines the kit shadow scale and keeps the card alias', () => {
    for (const shadow of ['--hf-shadow-xs', '--hf-shadow-sm', '--hf-shadow-md', '--hf-shadow-lg']) {
      expect(tokens).toContain(`${shadow}:`);
    }
    expect(tokens).toContain('--hf-shadow-card: var(--hf-shadow-sm);');
  });

  it('defines the kit type scale', () => {
    for (const size of ['h1', 'h2', 'h3', 'body', 'small', 'caption', 'display']) {
      expect(tokens).toContain(`--hf-font-size-${size}:`);
    }
  });

  it('no longer references legacy brand variables anywhere in the app', () => {
    const files = collectFiles(appDir, ['.vue', '.css', '.ts']).filter(
      (file) => !file.endsWith('tokens.test.ts'),
    );
    const offenders = files.filter((file) => {
      const content = readFileSync(file, 'utf8');
      return legacyTokens.some((token) => content.includes(token));
    });

    expect(offenders).toEqual([]);
  });

  it('flips text to light and background to dark inside the dark theme block', () => {
    const darkBlockMatch = tokens.match(/\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1]!;

    function hexOf(name: string): string {
      const match = darkBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(
        match,
        `expected ${name} to be set to a literal hex colour in the dark block`,
      ).not.toBeNull();
      return match![1]!;
    }

    // Cheap relative-luminance approximation — good enough to tell "clearly
    // light" from "clearly dark" without pulling in a colour library.
    function luminance(hex: string): number {
      const value = Number.parseInt(hex.slice(1), 16);
      const r = (value >> 16) & 0xff;
      const g = (value >> 8) & 0xff;
      const b = value & 0xff;
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // Regression guard: slate-900 backs --hf-color-text and slate-50 backs
    // --hf-color-page-background in :root. A previous dark-mode pass set
    // both to the same dark navy, which rendered every default-coloured
    // amount as invisible dark-on-dark text.
    expect(luminance(hexOf('--hf-color-slate-900'))).toBeGreaterThan(0.6);
    expect(luminance(hexOf('--hf-color-slate-50'))).toBeLessThan(0.2);
  });

  it('keeps WCAG AA contrast between text-level tokens and the surface, in both themes', () => {
    const lightBlockMatch = tokens.match(/:root\s*\{([\s\S]*?)\}/);
    expect(lightBlockMatch).not.toBeNull();
    const lightBlock = lightBlockMatch![1]!;
    const darkBlockMatch = tokens.match(/\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1]!;

    function hexOf(block: string, name: string): string {
      const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(
        match,
        `expected ${name} to be set to a literal hex colour in this theme block`,
      ).not.toBeNull();
      return match![1]!;
    }

    // The real WCAG 2.x relative luminance (sRGB linearization + Rec. 709
    // coefficients). Unlike the cheap approximation in the dark-theme test
    // above, this one is what the formal 4.5:1 AA ratio is defined over.
    function relativeLuminance(hex: string): number {
      const value = Number.parseInt(hex.slice(1), 16);
      const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((channel) => {
        const srgb = channel / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    }

    function contrast(foreground: string, background: string): number {
      const a = relativeLuminance(foreground);
      const b = relativeLuminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    const cases: [string, string, number][] = [
      [lightBlock, '--hf-color-text-danger', 6.0],
      [lightBlock, '--hf-color-text-secondary', 4.5],
      [lightBlock, '--hf-color-action-primary-text', 4.5],
      [darkBlock, '--hf-color-text-danger', 4.5],
      [darkBlock, '--hf-color-text-secondary', 4.5],
      [darkBlock, '--hf-color-action-primary-text', 4.5],
    ];

    for (const [block, name, minimum] of cases) {
      const foreground = hexOf(block, name);
      const surface = hexOf(block, '--hf-color-surface');
      const ratio = contrast(foreground, surface);
      expect(
        ratio,
        `expected ${name} (${foreground}) on ${surface} to reach at least ${minimum}:1`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('has no dangling --hf-color- references left unmapped after the rewrite', () => {
    const definedTokens = new Set(
      Array.from(tokens.matchAll(/(--hf-color-[a-zA-Z0-9-]+)\s*:/g)).map((match) => match[1]),
    );
    const files = collectFiles(appDir, ['.vue', '.css']);
    const referencedTokens = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/var\((--hf-color-[a-zA-Z0-9-]+)/g)) {
        const token = match[1];
        if (token) referencedTokens.add(token);
      }
    }

    const dangling = Array.from(referencedTokens).filter((token) => !definedTokens.has(token));

    expect(dangling).toEqual([]);
  });
});
