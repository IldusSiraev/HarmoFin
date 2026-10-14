import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { BudgetApplicationService } from './budget.application.service.js';
import { BudgetDetailResponse, CreateBudgetRequest } from './budget.dto.js';
import { createBudgetSchema, type CreateBudgetInput } from './budget.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('budgets')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class BudgetController {
  constructor(
    @Inject(BudgetApplicationService) private readonly service: BudgetApplicationService,
  ) {}

  @Get('workspaces/:workspaceId/budgets')
  @ApiOkResponse({ type: [BudgetDetailResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  listForWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listForWorkspace(contextOf(request).userId, workspaceId);
  }

  @Post('workspaces/:workspaceId/budgets')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateBudgetRequest })
  @ApiCreatedResponse({ type: BudgetDetailResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  create(
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(createBudgetSchema)) input: CreateBudgetInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(contextOf(request).userId, workspaceId, input, request.id);
  }

  @Get('budgets/:budgetId')
  @ApiOkResponse({ type: BudgetDetailResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.service.get(contextOf(request).userId, budgetId);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
