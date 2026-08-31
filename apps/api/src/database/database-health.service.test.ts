import { describe, expect, it, vi } from 'vitest';

import { DatabaseHealthService, type DatabasePool } from './database-health.service.js';

describe('DatabaseHealthService', () => {
  it('runs a SELECT 1 probe', async () => {
    const pool: DatabasePool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DatabaseHealthService(pool);

    await expect(service.check()).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('closes its pool', async () => {
    const pool: DatabasePool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DatabaseHealthService(pool);

    await service.close();

    expect(pool.end).toHaveBeenCalledOnce();
  });
});
