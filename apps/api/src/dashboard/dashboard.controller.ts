import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { DashboardApplicationService } from './dashboard.application.service.js';
import { DashboardSummaryResponse } from './dashboard.dto.js';

@ApiTags('dashboard')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class DashboardController {
  constructor(
    @Inject(DashboardApplicationService) private readonly service: DashboardApplicationService,
  ) {}

  @Get('budgets/:budgetId/summary')
  @ApiOkResponse({ type: DashboardSummaryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Req() request: FastifyRequest & { authContext?: RequestContext },
  ) {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    return this.service.currentSummary(context.userId, budgetId);
  }
}
