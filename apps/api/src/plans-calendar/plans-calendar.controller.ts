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
import { PlansCalendarResponse } from './plans-calendar.dto.js';
import { PlansCalendarApplicationService } from './plans-calendar.application.service.js';
import { plansCalendarQuerySchema, type PlansCalendarQuery } from './plans-calendar.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('plans calendar (v2)')
@Controller({ path: 'budgets/:budgetId/plans/calendar', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class PlansCalendarController {
  constructor(
    @Inject(PlansCalendarApplicationService)
    private readonly service: PlansCalendarApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Календарь планов месяца: факты и планы по дням, просрочка, итоги',
    description:
       'Все суммы строки minor units, расчёт на сервере одним снимком. Факты дня: только CONFIRMED и не удалённые доходы/расходы (переводы не входят). Плановые итоги: occurrences месяца без CANCELLED и SKIPPED. overdue — все открытые просроченные платежи бюджета независимо от месяца. Доступно любому активному участнику. События списка и просрочки несут owner (владелец плана) и canEdit (может ли текущий участник управлять этим планом); filter ownerUserId показывает только события планов указанного владельца. Коды: 400 VALIDATION_FAILED, 401, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({
    name: 'ownerUserId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Только планы, владельцем которых является указанный пользователь.',
  })
  @ApiQuery({
    name: 'month',
    required: true,
    schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-09' },
  })
  @ApiOkResponse({ type: PlansCalendarResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse, description: 'VALIDATION_FAILED.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
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
  calendar(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(plansCalendarQuerySchema)) query: PlansCalendarQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlansCalendarResponse> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.calendar(context.userId, budgetId, query);
  }
}
