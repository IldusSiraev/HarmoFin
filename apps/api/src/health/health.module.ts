import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

@Module({})
export class HealthModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: HealthModule,
      imports: [DatabaseModule.register(config)],
      controllers: [HealthController],
    };
  }
}
