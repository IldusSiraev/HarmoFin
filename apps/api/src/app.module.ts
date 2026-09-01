import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { API_CONFIG } from './common/security/security.constants.js';
import type { ApiConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.register(config), HealthModule, AuthModule.register(config)],
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}
