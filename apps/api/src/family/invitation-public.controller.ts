import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  AcceptedInvitationResponse,
  AcceptInvitationRequest,
  InvitationPreviewResponse,
  InvitationTokenRequest,
} from './family.dto.js';
import {
  acceptInvitationSchema,
  invitationTokenSchema,
  type AcceptInvitationInput,
  type InvitationTokenInput,
} from './family.schemas.js';
import { InvitationsApplicationService } from './invitations.application.service.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

/**
 * Public on purpose: the invite page shows who invites before sign-in. No session and no CSRF;
 * the global OriginGuard still requires the web origin and AuthRateLimitGuard limits guessing.
 */
@ApiTags('family')
@Controller('invitations')
export class InvitationPreviewController {
  constructor(
    @Inject(InvitationsApplicationService) private readonly invitations: InvitationsApplicationService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  @ApiBody({ type: InvitationTokenRequest })
  @ApiOkResponse({ type: InvitationPreviewResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 410, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  preview(@Body(new ZodValidationPipe(invitationTokenSchema)) input: InvitationTokenInput) {
    return this.invitations.preview(input.token);
  }
}

@ApiTags('family')
@Controller('invitations')
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class InvitationAcceptController {
  constructor(
    @Inject(InvitationsApplicationService) private readonly invitations: InvitationsApplicationService,
  ) {}

  @Post('accept')
  @HttpCode(200)
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  @ApiBody({ type: AcceptInvitationRequest })
  @ApiOkResponse({ type: AcceptedInvitationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 410, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) input: AcceptInvitationInput,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.authContext) throw new Error('Missing authenticated request context.');
    return this.invitations.accept(request.authContext.userId, input, request.id);
  }
}
