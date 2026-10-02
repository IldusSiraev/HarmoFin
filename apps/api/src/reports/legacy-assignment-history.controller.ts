import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { LegacyAssignmentHistoryApplicationService } from './legacy-assignment-history.application.service.js';
import { LegacyAssignmentHistoryResponse } from './legacy-assignment-history.dto.js';
import {
  MAX_LEGACY_ASSIGNMENT_PAGE,
  legacyAssignmentHistoryQuerySchema,
  type LegacyAssignmentHistoryQuery,
} from './legacy-assignment-history.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

/**
 * Read-only. The static `legacy-assignments` segment is registered by its own controller under the
 * same `history` prefix as the POST `:transactionId/...` routes; methods and segment counts differ,
 * so the routes cannot shadow each other.
 */
@ApiTags('history (v2)')
@Controller({ path: 'budgets/:budgetId/history', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class LegacyAssignmentHistoryController {
  constructor(
    @Inject(LegacyAssignmentHistoryApplicationService)
    private readonly service: LegacyAssignmentHistoryApplicationService,
  ) {}

  @Get('legacy-assignments')
  @ApiOperation({
    summary: 'Архив назначений модели 1',
    description:
      'Только владелец (OWNER) бюджета модели 2. Только чтение: старые распределения доходов, перераспределения конвертов и стартовые остатки конвертов, включая отменённые, логически удалённые и архивные, с пометками. Эти суммы не входят ни в какой остаток, funded или «Свободно» модели 2. Порядок: (occurredOn, sourceKind, id) по возрастанию, курсор непрозрачный и привязан к бюджету.',
  })
  @ApiParam({ name: 'budgetId', type: String, format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: MAX_LEGACY_ASSIGNMENT_PAGE, default: 50 },
  })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', maxLength: 256 } })
  @ApiOkResponse({ type: LegacyAssignmentHistoryResponse })
  @ApiResponse({
    status: 400,
    type: ProblemDetailsResponse,
    description:
      'VALIDATION_FAILED: некорректные limit/cursor, курсор другого бюджета, неизвестные параметры.',
  })
  @ApiResponse({
    status: 401,
    type: ProblemDetailsResponse,
    description: 'Нет действующей сессии.',
  })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN: действие доступно только владельцу (OWNER).',
  })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет не найден или недоступен.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH: бюджет работает на модели v1.',
  })
  list(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(legacyAssignmentHistoryQuerySchema))
    query: LegacyAssignmentHistoryQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.list(context.userId, budgetId, query);
  }
}
