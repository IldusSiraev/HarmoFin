import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  it('disconnects once when Nest destroys it more than once', async () => {
    const service = Object.create(PrismaService.prototype) as PrismaService;
    const disconnect = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { $disconnect: disconnect });

    await service.onModuleDestroy();
    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
