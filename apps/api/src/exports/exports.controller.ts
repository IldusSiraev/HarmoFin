import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CsvExportApplicationService } from './csv-export.application.service.js';
import { csvExportResponse } from './exports.dto.js';
import { exportTransactionsSchema, type ExportTransactionsInput } from './exports.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('exports')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ExportsController {
  constructor(
    @Inject(CsvExportApplicationService)
    private readonly service: CsvExportApplicationService,
  ) {}

  @Get('budgets/:budgetId/exports/transactions.csv')
  @ApiProduces('text/csv')
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string', maxLength: 250 } })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'cycleStart', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'periodStart', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'accountId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'categoryId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'envelopeId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'planId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'type', required: false, enum: ['INCOME', 'EXPENSE'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED', 'all'],
  })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['occurredOn', 'amount'] })
  @ApiQuery({ name: 'sortDirection', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse(csvExportResponse)
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async transactions(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(exportTransactionsSchema)) query: ExportTransactionsInput,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    const result = await this.service.exportTransactions(context.userId, budgetId, query);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.content);
  }
}
