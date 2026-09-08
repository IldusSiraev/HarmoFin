import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ReportApplicationService } from './report.application.service.js';
import { ReportResponse } from './report.dto.js';
import {
  reportFiltersSchema,
  reportKeySchema,
  type ReportFilters,
  type ReportKey,
} from './report.schemas.js';

@ApiTags('reports')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ReportController {
  constructor(
    @Inject(ReportApplicationService) private readonly service: ReportApplicationService,
  ) {}

  @Get('budgets/:budgetId/reports/:reportKey')
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'accountId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'categoryId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'envelopeId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'type', required: false, enum: ['INCOME', 'EXPENSE'] })
  @ApiQuery({ name: 'currency', required: false, enum: ['RUB'] })
  @ApiOkResponse({ type: ReportResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('reportKey', new ZodValidationPipe(reportKeySchema)) reportKey: ReportKey,
    @Query(new ZodValidationPipe(reportFiltersSchema)) query: ReportFilters,
    @Req() request: FastifyRequest & { authContext?: RequestContext },
  ) {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.get(context.userId, budgetId, reportKey, query);
  }
}
