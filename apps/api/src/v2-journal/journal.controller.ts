import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { budgetIdParamSchema } from '../v2-transactions/transaction-v2.schemas.js';
import { JournalApplicationService } from './journal.application.service.js';
import { JournalPageResponse } from './journal.dto.js';
import { listJournalSchema, type ListJournalInput } from './journal.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

@ApiTags('journal (v2)')
@Controller({ path: 'budgets/:budgetId/journal', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class JournalController {
  constructor(
    @Inject(JournalApplicationService) private readonly service: JournalApplicationService,
  ) {}

  @Get()
  @ApiOkResponse({ type: JournalPageResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  list(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(listJournalSchema)) query: ListJournalInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }
}
