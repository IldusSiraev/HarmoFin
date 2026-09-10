import { describe, expect, it, vi } from 'vitest';

import type { DatabaseHealthService } from '../database/database-health.service.js';
import type { MetricsRegistry } from '../observability/observability.js';
import { HealthController } from './health.controller.js';

function fakeMetrics(): MetricsRegistry {
  return {
    setDatabaseReadiness: vi.fn(),
    recordDatabaseLatency: vi.fn(),
    increment: vi.fn(),
  } as unknown as MetricsRegistry;
}

describe('HealthController', () => {
  it('reports a live process', () => {
    const controller = new HealthController(
      { check: vi.fn() } as unknown as DatabaseHealthService,
      fakeMetrics(),
    );

    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports a ready database dependency', async () => {
    const database = { check: vi.fn().mockResolvedValue(undefined) };
    const controller = new HealthController(
      database as unknown as DatabaseHealthService,
      fakeMetrics(),
    );

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ok' },
    });
  });

  it('translates database failures to a safe service unavailable error', async () => {
    const database = { check: vi.fn().mockRejectedValue(new Error('password=secret SELECT 1')) };
    const controller = new HealthController(
      database as unknown as DatabaseHealthService,
      fakeMetrics(),
    );

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
      },
    });
  });
});
