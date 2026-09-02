import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service.js';

@Injectable()
export class DatabaseHealthService implements OnApplicationShutdown {
  private closed = false;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    await this.prisma.onModuleDestroy();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}
