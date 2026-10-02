import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { ReportV2ApplicationService } from './report-v2.application.service.js';
import {
  ReportV2AccountBalancesResponse,
  ReportV2AssignmentMovementsResponse,
  ReportV2ExpensesByCategoryResponse,
  ReportV2ExpensesByCycleResponse,
  ReportV2ExpensesByPeriodResponse,
  ReportV2IncomesByCycleResponse,
  ReportV2NetCashFlowResponse,
  ReportV2PlanVsActualResponse,
  ReportV2SavingsGoalsResponse,
  reportV2FiltersSchema,
  reportV2KeySchema,
  reportV2Keys,
  type ReportV2Filters,
  type ReportV2Key,
} from './report-v2.dto.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const RESPONSES = [
  ReportV2AccountBalancesResponse,
  ReportV2ExpensesByCategoryResponse,
  ReportV2ExpensesByPeriodResponse,
  ReportV2ExpensesByCycleResponse,
  ReportV2IncomesByCycleResponse,
  ReportV2NetCashFlowResponse,
  ReportV2SavingsGoalsResponse,
  ReportV2PlanVsActualResponse,
  ReportV2AssignmentMovementsResponse,
];

@ApiTags('reports (v2)')
@Controller({ path: 'budgets/:budgetId/reports', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
@ApiExtraModels(...RESPONSES)
export class ReportV2Controller {
  constructor(
    @Inject(ReportV2ApplicationService) private readonly service: ReportV2ApplicationService,
  ) {}

  @Get(':key')
  @ApiOperation({
    summary: 'Отчёты модели плана v2',
    description:
      'Суммы строками в minor units, расчёт на сервере из CONFIRMED-фактов одним снимком; доступно любому активному участнику (VIEWER тоже). Накопления считаются по непрерывному v2-остатку назначений, старые v1 расходы входят в реальные деньги, но не списываются с v2-назначений. account-balances и savings-goals кумулятивны: дата расчёта to (по умолчанию сегодня), from игнорируется. Неизвестный key даёт 400 VALIDATION_FAILED (как в v1), чужой или несуществующий accountId/categoryId/envelopeId даёт 404 RESOURCE_NOT_FOUND до расчёта.',
  })
  @ApiParam({ name: 'budgetId', type: String, format: 'uuid' })
  @ApiParam({ name: 'key', type: String, enum: reportV2Keys })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'accountId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'categoryId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'envelopeId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: { oneOf: RESPONSES.map((model) => ({ $ref: getSchemaPath(model) })) } })
  @ApiResponse({
    status: 400,
    type: ProblemDetailsResponse,
    description: 'VALIDATION_FAILED: неизвестный key, некорректные параметры.',
  })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет или объект фильтра не найден или чужой.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH: бюджет работает на модели v1.',
  })
  get(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Param('key', new ZodValidationPipe(reportV2KeySchema)) key: ReportV2Key,
    @Query(new ZodValidationPipe(reportV2FiltersSchema)) query: ReportV2Filters,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.get(context.userId, budgetId, key, query);
  }
}
