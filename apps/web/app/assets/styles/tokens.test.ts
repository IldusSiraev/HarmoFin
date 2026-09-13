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
  ['--hf-color-brand', '#0a7f60'],
  ['--hf-color-brand-hover', '#086b51'],
  ['--hf-color-brand-bright', '#10b991'],
  ['--hf-color-brand-soft', '#e7f7f2'],
  ['--hf-color-action-primary', '#1d6fd6'],
  ['--hf-color-primary-bright', '#4f9cf9'],
  ['--hf-color-primary-soft', '#e6f2ff'],
  ['--hf-color-action-danger', '#dc2626'],
  ['--hf-color-status-danger-bright', '#ef4444'],
  ['--hf-color-status-warning-bright', '#f59e0b'],
  ['--hf-color-text', '#0f172a'],
  ['--hf-color-text-muted', '#64748b'],
  ['--hf-color-border', '#e2e8f0'],
  ['--hf-color-page-background', '#f8fafc'],
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
    expect(tokens).toContain('--hf-radius-sm: 0.25rem;');
    expect(tokens).toContain('--hf-radius-md: 0.5rem;');
    expect(tokens).toContain('--hf-radius-lg: 0.75rem;');
    expect(tokens).toContain('--hf-radius-xl: 1rem;');
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
