import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiNoContentResponse, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ChangeRoleRequest, MemberResponse } from './family.dto.js';
import { changeRoleSchema, uuidParamSchema, type ChangeRoleInput } from './family.schemas.js';
import { MembersApplicationService } from './members.application.service.js';

const UuidParam = () => new ZodValidationPipe(uuidParamSchema);

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('family')
@Controller('workspaces/:workspaceId')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class FamilyController {
  constructor(
    @Inject(MembersApplicationService) private readonly members: MembersApplicationService,
  ) {}

  @Get('members')
  @ApiOkResponse({ type: [MemberResponse] })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('workspaceId', UuidParam()) workspaceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.members.list(contextOf(request).userId, workspaceId);
  }

  @Patch('members/:membershipId')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: ChangeRoleRequest })
  @ApiOkResponse({ type: MemberResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  changeRole(
    @Param('workspaceId', UuidParam()) workspaceId: string,
    @Param('membershipId', UuidParam()) membershipId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) input: ChangeRoleInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.members.changeRole(
      contextOf(request).userId,
      workspaceId,
      membershipId,
      input.role,
      request.id,
    );
  }

  @Delete('members/:membershipId')
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  remove(
    @Param('workspaceId', UuidParam()) workspaceId: string,
    @Param('membershipId', UuidParam()) membershipId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.members.remove(contextOf(request).userId, workspaceId, membershipId, request.id);
  }

  @Post('leave')
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  leave(
    @Param('workspaceId', UuidParam()) workspaceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.members.leave(contextOf(request).userId, workspaceId, request.id);
  }

  @Post('select')
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  select(
    @Param('workspaceId', UuidParam()) workspaceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.members.select(contextOf(request).userId, workspaceId);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
