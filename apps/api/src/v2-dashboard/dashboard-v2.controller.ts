import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
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
import { DashboardV2ApplicationService } from './dashboard-v2.application.service.js';
import { DashboardV2Response } from './dashboard-v2.dto.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('dashboard (v2)')
@Controller({ path: 'budgets/:budgetId/dashboard', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class DashboardV2Controller {
  constructor(
    @Inject(DashboardV2ApplicationService)
    private readonly service: DashboardV2ApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Главная: «Можно потратить» и объяснение (модель плана v2)',
    description:
      'Одно главное число spendable и короткое объяснение; все суммы строки в minor units, расчёт на сервере из CONFIRMED-фактов одним снимком. Доступно любому активному участнику (VIEWER тоже); OWNER/EDITOR при просмотре текущего периода могут создать структурную строку периода без записи назначений. spendable.state=NEEDS_PERIOD_SETUP — суммы нет, ложный 0 не отдаётся. dueMayBeIncomplete=true для VIEWER или когда asOf вне текущего периода. Коды: 400 VALIDATION_FAILED, 401, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({
    name: 'asOf',
    required: false,
    schema: { type: 'string', format: 'date', example: '2026-03-10' },
    description: 'Дата расчёта YYYY-MM-DD; по умолчанию сегодня в часовом поясе бюджета.',
  })
  @ApiOkResponse({ type: DashboardV2Response })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse, description: 'VALIDATION_FAILED.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет не найден или чужой.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH: бюджет работает на модели v1.',
  })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async get(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Query('asOf') asOf: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<DashboardV2Response> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    const summary = await this.service.summary(context.userId, budgetId, asOf);
    return { planModelVersion: 2, ...summary };
  }
}
