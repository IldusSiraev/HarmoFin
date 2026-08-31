import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import {
  createDatabasePool,
  DATABASE_POOL,
  DatabaseHealthService,
} from './database-health.service.js';

@Module({})
export class DatabaseModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_POOL,
          useFactory: () => createDatabasePool(config.databaseUrl),
        },
        DatabaseHealthService,
      ],
      exports: [DatabaseHealthService],
    };
  }
}
