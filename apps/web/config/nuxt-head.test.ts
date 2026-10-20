import { describe, expect, it, vi } from 'vitest';

describe('nuxt.config app head', () => {
  // Pages without their own title (the whole /app area, auth pages) must still
  // get one on a full reload, not only when reached from the landing page.
  it('sets a default document title for every page', async () => {
    vi.stubGlobal('defineNuxtConfig', (config: unknown) => config);
    const { default: config } = (await import('../nuxt.config.js')) as {
      default: { app: { head: { title?: string } } };
    };
    vi.unstubAllGlobals();

    expect(config.app.head.title).toBe('HarmoFin');
  });
});
