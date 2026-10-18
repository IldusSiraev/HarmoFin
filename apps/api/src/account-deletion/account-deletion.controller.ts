import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  cookieOptions,
  requestMeta,
  requiredContext,
  type AuthenticatedRequest,
} from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import type { ApiConfig } from '../config/env.js';
import { AccountDeletionApplicationService } from './account-deletion.application.service.js';
import {
  AccountDeletionScheduledResponse,
  CancelAccountDeletionRequest,
  RequestAccountDeletionRequest,
} from './account-deletion.dto.js';
import {
  cancelDeletionSchema,
  requestDeletionSchema,
  type CancelDeletionInput,
  type RequestDeletionInput,
} from './account-deletion.schemas.js';

@ApiTags('auth')
@Controller()
export class AccountDeletionController {
  constructor(
    @Inject(AccountDeletionApplicationService)
    private readonly service: AccountDeletionApplicationService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('me/deletion')
  @HttpCode(202)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiBody({ type: RequestAccountDeletionRequest })
  @ApiAcceptedResponse({ type: AccountDeletionScheduledResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async requestDeletion(
    @Body(new ZodValidationPipe(requestDeletionSchema)) input: RequestDeletionInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountDeletionScheduledResponse> {
    const context = requiredContext(request);
    const meta = requestMeta(request);
    const result = await this.service.requestDeletion(context.userId, input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
    return { purgeAfter: result.purgeAfter.toISOString() };
  }

  @Post('auth/deletion/cancel')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiBody({ type: CancelAccountDeletionRequest })
  @ApiNoContentResponse({ description: 'Удаление отменено. Войдите обычным способом.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async cancelDeletion(
    @Body(new ZodValidationPipe(cancelDeletionSchema)) input: CancelDeletionInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.cancelDeletion(input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
}
