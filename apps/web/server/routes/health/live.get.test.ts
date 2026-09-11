import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web liveness route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a static safe response', async () => {
    const { default: live } = await import('./live.get.js');

    expect(live({} as never)).toEqual({ status: 'ok' });
  });
});
