import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
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
import {
  CreateWorkspaceRequest,
  WorkspaceSummaryResponse,
  WorkspaceWithBudgetResponse,
} from './workspace.dto.js';
import { WorkspaceApplicationService } from './workspace.application.service.js';
import { createWorkspaceSchema, type CreateWorkspaceInput } from './workspace.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceApplicationService) private readonly service: WorkspaceApplicationService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [WorkspaceSummaryResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(contextOf(request).userId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateWorkspaceRequest })
  @ApiCreatedResponse({ type: WorkspaceWithBudgetResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  create(
    @Body(new ZodValidationPipe(createWorkspaceSchema)) input: CreateWorkspaceInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(contextOf(request).userId, input, request.id);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
