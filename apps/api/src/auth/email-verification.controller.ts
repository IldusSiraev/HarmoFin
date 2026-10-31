import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { requestMeta, requiredContext, type AuthenticatedRequest } from './auth-http.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { EmailVerificationApplicationService } from './email-verification.application.service.js';
import { EmailVerificationConfirmRequest } from './email-verification.dto.js';
import {
  emailVerificationConfirmSchema,
  type EmailVerificationConfirmInput,
} from './email-verification.schemas.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@ApiTags('auth')
@Controller()
export class EmailVerificationController {
  constructor(
    @Inject(EmailVerificationApplicationService)
    private readonly service: EmailVerificationApplicationService,
  ) {}

  @Post('me/email-verification')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отправить письмо подтверждения почты',
    description:
      'Гасит прежние неиспользованные ссылки и отправляет новую на 24 часа. Если почта уже подтверждена — 204 без письма. Коды: 401, 403 CSRF_INVALID/ORIGIN_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiNoContentResponse({ description: 'Запрос принят.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async request(@Req() request: AuthenticatedRequest): Promise<void> {
    const meta = requestMeta(request);
    await this.service.request(requiredContext(request).userId, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }

  @Post('auth/email-verification/confirm')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Подтвердить почту по ссылке из письма',
    description:
      'Публичный: открывается из письма, возможно без входа. Без сессии и CSRF; глобальный OriginGuard требует origin веба. Коды: 400 VALIDATION_FAILED, 403 ORIGIN_REQUIRED, 422 EMAIL_VERIFICATION_TOKEN_INVALID, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: EmailVerificationConfirmRequest })
  @ApiNoContentResponse({ description: 'Почта подтверждена.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async confirm(
    @Body(new ZodValidationPipe(emailVerificationConfirmSchema))
    input: EmailVerificationConfirmInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.confirm(input.token, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
}
