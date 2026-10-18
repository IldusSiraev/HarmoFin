import { describe, expect, it, vi } from 'vitest';

import { registerServiceWorker } from './register-service-worker.js';

function container(register = vi.fn().mockResolvedValue({})) {
  return { register } as unknown as ServiceWorkerContainer & { register: typeof register };
}

describe('registerServiceWorker', () => {
  it('registers /sw.js for the whole origin in production builds', async () => {
    const workers = container();

    await registerServiceWorker({ dev: false, container: workers });

    expect(workers.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('skips registration in development so stale workers never shadow the dev server', async () => {
    const workers = container();

    await registerServiceWorker({ dev: true, container: workers });

    expect(workers.register).not.toHaveBeenCalled();
  });

  it('does nothing in browsers without service worker support', async () => {
    await expect(
      registerServiceWorker({ dev: false, container: undefined }),
    ).resolves.toBeUndefined();
  });

  it('keeps the app working when registration fails', async () => {
    const workers = container(vi.fn().mockRejectedValue(new Error('SecurityError')));

    await expect(
      registerServiceWorker({ dev: false, container: workers }),
    ).resolves.toBeUndefined();
  });
});
