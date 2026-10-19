import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Note: resolved via fileURLToPath(import.meta.url) + path.join rather than
// `new URL('./x', import.meta.url)` because the happy-dom test environment
// replaces the global URL implementation, which also leaks into the `URL`
// export of `node:url` and breaks file:// base resolution.
const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * A legal text may change only together with a new edition. When this test fails: bump the version
 * in apps/api/src/legal/legal-documents.ts (and its pinned test), then record the new version and
 * hash here. Procedure: docs/runbooks/public-launch-legal.md, step 11.
 */
const EDITIONS = {
  'PrivacyPolicyText.vue': {
    version: '2026-10-18',
    sha256: '8dc46d25a86e1aa4dacbf1a0b23dd08d544bc7adc00b7989e27bc631ce1ec1e7',
  },
  'TermsText.vue': {
    version: '2026-10-18',
    sha256: '4320cbe8dc0520c6474971c347404f5b331062c38d27bf1f4c76e3b2dc5ec8a2',
  },
  'PdConsentText.vue': {
    version: '2026-10-18',
    sha256: '33db33f8ac7dbc4347e2c56166557ebe2148ccdc179e0409a0f645cd909c9cbd',
  },
} as const;

function templateHash(file: string): string {
  const source = readFileSync(join(currentDir, file), 'utf8');
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? '';
  return createHash('sha256').update(template.replace(/\s+/g, ' ').trim()).digest('hex');
}

describe('legal texts', () => {
  it.each(Object.entries(EDITIONS))('%s matches its recorded edition', (file, edition) => {
    expect(templateHash(file)).toBe(edition.sha256);
  });
});
