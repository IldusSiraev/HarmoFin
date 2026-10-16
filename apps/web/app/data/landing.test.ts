import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The landing speaks the UI glossary (docs/superpowers/specs/2026-10-16-ui-glossary-design.md):
// none of the internal model terms may reach a visitor.
const FORBIDDEN = [
  /назнач/i,
  /Свободные/,
  /Обязательства/,
  /Периодн/,
  /Пользовательская/,
  /защищен/i,
  /горизонт/i,
];

const appRoot = path.resolve(__dirname, '..');

function landingSources(): string[] {
  const dir = path.join(appRoot, 'components/landing');
  const vueFiles = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => path.join(dir, file));
  return [
    ...vueFiles,
    path.join(appRoot, 'data/landing.ts'),
    path.join(appRoot, 'data/landing-seo.ts'),
    path.join(appRoot, 'pages/index.vue'),
  ];
}

describe('landing copy', () => {
  it.each(landingSources())('uses only glossary terms in %s', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      expect(text, `${path.relative(appRoot, file)} matches ${pattern}`).not.toMatch(pattern);
    }
  });
});
