import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import { MetricsRegistry } from './observability.js';

@Global()
@Module({})
export class ObservabilityModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [
        {
          provide: MetricsRegistry,
          useFactory: () =>
            new MetricsRegistry({
              service: 'api',
              environment: config.nodeEnv,
              releaseSha: config.releaseSha,
            }),
        },
      ],
      exports: [MetricsRegistry],
    };
  }
}
