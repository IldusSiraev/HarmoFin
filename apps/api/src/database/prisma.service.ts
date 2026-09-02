import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private disconnected = false;

  constructor(databaseUrl: string) {
    super({ datasources: { db: { url: databaseUrl } } });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.disconnected) return;

    this.disconnected = true;
    await this.$disconnect();
  }
}
