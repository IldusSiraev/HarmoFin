import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from './config/env.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule.register(config)],
    };
  }
}
