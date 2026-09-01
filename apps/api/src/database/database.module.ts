import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({})
export class DatabaseModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(config.databaseUrl),
        },
        DatabaseHealthService,
      ],
      exports: [PrismaService, DatabaseHealthService],
    };
  }
}
