import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestBlob: vi.fn(),
  reloadNuxtApp: vi.fn(),
  order: [] as string[],
  unsubscribeThisDevice: vi.fn(),
}));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

vi.mock('#imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#imports')>();
  return { ...actual, reloadNuxtApp: mocks.reloadNuxtApp };
});

vi.mock('../pwa/push.js', () => ({ unsubscribeThisDevice: mocks.unsubscribeThisDevice }));

import { useAuth } from './useAuth.js';

describe('useAuth logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.unsubscribeThisDevice.mockImplementation(async () => {
      mocks.order.push('unsubscribe');
    });
    mocks.request.mockImplementation(async () => {
      mocks.order.push('logout');
      return undefined;
    });
  });

  it('drops the browser push subscription before signing out', async () => {
    await useAuth().logout();
    expect(mocks.order).toEqual(['unsubscribe', 'logout']);
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' });
  });
});
