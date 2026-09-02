import { describe, expect, it, vi } from 'vitest';

import { DatabaseHealthService } from './database-health.service.js';
import type { PrismaService } from './prisma.service.js';

describe('DatabaseHealthService', () => {
  it('runs a SELECT 1 probe through Prisma', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    const service = new DatabaseHealthService(prisma);

    await expect(service.check()).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('closes the shared Prisma client once', async () => {
    const prisma = {
      $queryRaw: vi.fn(),
      onModuleDestroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrismaService;
    const service = new DatabaseHealthService(prisma);

    await service.close();
    await service.close();

    expect(prisma.onModuleDestroy).toHaveBeenCalledOnce();
  });
});
