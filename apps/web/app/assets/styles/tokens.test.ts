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
