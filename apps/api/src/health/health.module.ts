import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import { HealthController } from './health.controller.js';

@Module({})
export class HealthModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: API_CONFIG, useValue: config }],
    };
  }
}
