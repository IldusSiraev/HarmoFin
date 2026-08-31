import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { DatabaseHealthService } from '../database/database-health.service.js';
import { LiveHealthResponse, ReadyHealthResponse } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseHealthService)
    private readonly databaseHealth: DatabaseHealthService,
  ) {}

  @Get('live')
  @ApiOkResponse({ type: LiveHealthResponse })
  live(): LiveHealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: ReadyHealthResponse })
  @ApiResponse({ status: 503, type: ProblemDetailsResponse })
  async ready(): Promise<ReadyHealthResponse> {
    try {
      await this.databaseHealth.check();
      return { status: 'ok', dependencies: { database: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
      });
    }
  }
}
