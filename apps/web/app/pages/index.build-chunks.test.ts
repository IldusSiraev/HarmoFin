import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// This guard reads Nuxt/Vite's *built* client manifest and walks the static
// (non-lazy) import graph reachable from the landing page's own chunk. It
// fails if that graph ever reaches a chunk whose emitted JS contains the
// `echarts` library, which would mean the marketing landing page started
// preloading the ~1.1 MB chart library that only `pages/app/analytics.vue`
// is supposed to load. The three landing charts are hand-written SVG for
// exactly this reason (see the development spec's performance section).
//
// The check needs real build output to inspect, so it only runs after
// `pnpm --filter @harmofin/web build` has produced `apps/web/.output`. When
// that directory is absent (e.g. a plain `pnpm test` in a fresh checkout),
// the suite below is skipped rather than failing.
const webRoot = path.resolve(__dirname, '../..');
const manifestPath = path.join(webRoot, '.output/server/chunks/virtual/precomputed.mjs');
const nuxtAssetsDir = path.join(webRoot, '.output/public/_nuxt');
const buildOutputExists = existsSync(manifestPath);

interface ChunkDescriptor {
  file?: string;
  imports?: string[];
}

interface ClientManifest {
  dependencies: Record<string, { preload: Record<string, ChunkDescriptor> }>;
}

const suiteTitle = buildOutputExists
  ? 'landing bundle chunk isolation (built output)'
  : `landing bundle chunk isolation (built output) — skipped: no build at ${manifestPath}; run "pnpm --filter @harmofin/web build" first`;

describe.skipIf(!buildOutputExists)(suiteTitle, () => {
  it('pages/index.vue has no static import edge into a chunk that bundles echarts', async () => {
    const { default: manifest } = (await import(pathToFileURL(manifestPath).href)) as {
      default: ClientManifest;
    };

    const visited = new Set<string>();
    const queue: string[] = ['pages/index.vue'];
    const echartsChunks: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);

      const descriptor = manifest.dependencies[id]?.preload[id];
      if (!descriptor) continue;

      if (descriptor.file?.endsWith('.js')) {
        const assetPath = path.join(nuxtAssetsDir, descriptor.file);
        if (existsSync(assetPath) && readFileSync(assetPath, 'utf8').includes('echarts')) {
          echartsChunks.push(descriptor.file);
        }
      }

      for (const importedId of descriptor.imports ?? []) {
        queue.push(importedId);
      }
    }

    expect(
      echartsChunks,
      `pages/index.vue statically reaches an echarts-containing chunk: ${echartsChunks.join(
        ', ',
      )}. The landing page must only lazy-load its SVG mockups; check nuxt.config.ts` +
        ' (vite.build.rollupOptions.output.manualChunks) and any new static import between the' +
        ' landing page and pages/app/analytics.vue.',
    ).toEqual([]);
  });
});
