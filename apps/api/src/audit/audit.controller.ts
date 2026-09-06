import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { AuditApplicationService } from './audit.application.service.js';
import { AuditEventListResponse } from './audit.dto.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('audit')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class AuditController {
  constructor(@Inject(AuditApplicationService) private readonly service: AuditApplicationService) {}

  @Get('budgets/:budgetId/transactions/:transactionId/audit')
  @ApiOkResponse({ type: AuditEventListResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  listForTransaction(
    @Param('budgetId') budgetId: string,
    @Param('transactionId') transactionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listForTransaction(contextOf(request).userId, budgetId, transactionId);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
