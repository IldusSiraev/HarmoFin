import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CycleApplicationService } from './cycle.application.service.js';
import { CycleAndPeriodResponse } from './cycle.dto.js';
import { cycleQuerySchema, type CycleQueryInput } from './cycle.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('cycles')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class CycleController {
  constructor(@Inject(CycleApplicationService) private readonly service: CycleApplicationService) {}

  @Get('budgets/:budgetId/cycles/current')
  @ApiOkResponse({ type: CycleAndPeriodResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  current(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.service.current(contextOf(request).userId, budgetId);
  }

  @Get('budgets/:budgetId/cycles')
  @ApiOkResponse({ type: CycleAndPeriodResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  selected(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(cycleQuerySchema)) query: CycleQueryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return query.date
      ? this.service.selected(contextOf(request).userId, budgetId, query.date)
      : this.service.current(contextOf(request).userId, budgetId);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
