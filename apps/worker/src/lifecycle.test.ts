import { describe, expect, it, vi } from 'vitest';

import { shutdownWorker } from './lifecycle.js';

describe('shutdownWorker', () => {
  it('stops health checks before runner and database on SIGTERM', async () => {
    const events: string[] = [];
    const healthServer = {
      stop: vi.fn(async () => {
        events.push('health');
      }),
    };
    const runtime = {
      stop: vi.fn(async (signal: NodeJS.Signals) => {
        events.push(`runtime:${signal}`);
      }),
    };
    const database = {
      $disconnect: vi.fn(async () => {
        events.push('database');
      }),
    };

    await shutdownWorker('SIGTERM', { healthServer, runtime, database });

    expect(events).toEqual(['health', 'runtime:SIGTERM', 'database']);
  });
});
