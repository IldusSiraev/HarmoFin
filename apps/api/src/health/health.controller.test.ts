import { describe, expect, it, vi } from 'vitest';

import type { ApiConfig } from '../config/env.js';
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

const buildConfig = { appVersion: '1.2.3', releaseSha: 'abc1234' } as ApiConfig;

function controllerWith(database: Pick<DatabaseHealthService, 'check'>): HealthController {
  return new HealthController(
    database as unknown as DatabaseHealthService,
    fakeMetrics(),
    buildConfig,
  );
}

describe('HealthController', () => {
  it('reports a live process with its release version and revision', () => {
    const controller = controllerWith({ check: vi.fn() });

    expect(controller.live()).toEqual({ status: 'ok', version: '1.2.3', revision: 'abc1234' });
  });

  it('reports a ready database dependency', async () => {
    const controller = controllerWith({ check: vi.fn().mockResolvedValue(undefined) });

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ok' },
    });
  });

  it('translates database failures to a safe service unavailable error', async () => {
    const controller = controllerWith({
      check: vi.fn().mockRejectedValue(new Error('password=secret SELECT 1')),
    });

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
      },
    });
  });
});
