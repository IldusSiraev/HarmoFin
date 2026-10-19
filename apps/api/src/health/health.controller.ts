import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

import { API_CONFIG } from '../common/security/security.constants.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { ApiConfig } from '../config/env.js';
import { DatabaseHealthService } from '../database/database-health.service.js';
import { MetricsRegistry } from '../observability/observability.js';
import { LiveHealthResponse, ReadyHealthResponse } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseHealthService)
    private readonly databaseHealth: DatabaseHealthService,
    @Inject(MetricsRegistry)
    private readonly metrics: MetricsRegistry,
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
  ) {}

  @Get('live')
  @ApiOkResponse({ type: LiveHealthResponse })
  live(): LiveHealthResponse {
    return { status: 'ok', version: this.config.appVersion, revision: this.config.releaseSha };
  }

  @Get('ready')
  @ApiOkResponse({ type: ReadyHealthResponse })
  @ApiResponse({ status: 503, type: ProblemDetailsResponse })
  async ready(): Promise<ReadyHealthResponse> {
    const startedAt = Date.now();
    try {
      await this.databaseHealth.check();
      this.metrics.setDatabaseReadiness(1);
      this.metrics.recordDatabaseLatency(Date.now() - startedAt);
      return { status: 'ok', dependencies: { database: 'ok' } };
    } catch {
      this.metrics.setDatabaseReadiness(0);
      this.metrics.increment('database_errors_total');
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
      });
    }
  }
}
