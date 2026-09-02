import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RequestContext } from '../common/request-context/request-context.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import type { ApiConfig } from '../config/env.js';
import {
  AuthApplicationService,
  type AuthSessionResponse as ApplicationAuthSessionResponse,
  type RequestMeta,
} from './auth.application.service.js';
import {
  AuthSessionResponse,
  ChangePasswordRequest,
  CsrfTokenResponse,
  LoginRequest,
  MeResponse,
  RecoveryConfirmRequest,
  RecoveryRequest,
  RegisterRequest,
  SessionResponse,
} from './auth.dto.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import {
  changePasswordSchema,
  loginSchema,
  recoveryConfirmSchema,
  recoveryRequestSchema,
  registerSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RecoveryConfirmInput,
  type RecoveryRequestInput,
  type RegisterInput,
} from './auth.schemas.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    @Inject(AuthApplicationService) private readonly authService: AuthApplicationService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('auth/register')
  @ApiBody({ type: RegisterRequest })
  @ApiCreatedResponse({ type: AuthSessionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.register(input, requestMeta(request));
    return this.setSession(reply, result);
  }

  @Post('auth/login')
  @UseGuards(AuthRateLimitGuard)
  @ApiBody({ type: LoginRequest })
  @ApiOkResponse({ type: AuthSessionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const current = await this.optionalSession(request);
    const result = await this.authService.login(input, {
      ...requestMeta(request),
      ...(current ? { currentSessionId: current.sessionId } : {}),
    });
    return this.setSession(reply, result);
  }

  @Post('auth/logout')
  @HttpCode(204)
  @ApiCookieAuth('session')
  @ApiNoContentResponse()
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const session = await this.optionalSession(request);
    if (session) {
      const rawCsrfToken = request.headers['x-csrf-token'];
      if (
        typeof rawCsrfToken !== 'string' ||
        !this.tokenService.matchesDigest(rawCsrfToken, session.csrfTokenHash)
      ) {
        throw new ForbiddenException({
          code: 'CSRF_INVALID',
          detail: 'Защита запроса не пройдена.',
        });
      }
      await this.authService.logout(session.userId, session.sessionId);
    }
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Post('auth/recovery/request')
  @HttpCode(202)
  @UseGuards(AuthRateLimitGuard)
  @ApiBody({ type: RecoveryRequest })
  @ApiResponse({ status: 202, description: 'Запрос принят.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async requestRecovery(
    @Body(new ZodValidationPipe(recoveryRequestSchema)) input: RecoveryRequestInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.authService.requestRecovery(input.email, requestMeta(request));
  }

  @Post('auth/recovery/confirm')
  @ApiBody({ type: RecoveryConfirmRequest })
  @ApiOkResponse({ type: AuthSessionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async confirmRecovery(
    @Body(new ZodValidationPipe(recoveryConfirmSchema)) input: RecoveryConfirmInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.confirmRecovery(input, requestMeta(request));
    return this.setSession(reply, result);
  }

  @Get('auth/csrf')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOkResponse({ type: CsrfTokenResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  async csrf(@Req() request: AuthenticatedRequest) {
    const context = requiredContext(request);
    return { csrfToken: await this.authService.rotateCsrfToken(context.userId, context.sessionId) };
  }

  @Post('auth/password')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiBody({ type: ChangePasswordRequest })
  @ApiOkResponse({ type: AuthSessionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) input: ChangePasswordInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const context = requiredContext(request);
    const result = await this.authService.changePassword(
      context.userId,
      input,
      requestMeta(request),
    );
    return this.setSession(reply, result);
  }

  @Get('auth/sessions')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOkResponse({ type: [SessionResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  sessions(@Req() request: AuthenticatedRequest) {
    return this.authService.listSessions(requiredContext(request).userId);
  }

  @Delete('auth/sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const context = requiredContext(request);
    const { sessionId } = request.params as { sessionId: string };
    await this.authService.revokeSession(context.userId, sessionId);
    if (sessionId === context.sessionId)
      reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Delete('auth/sessions')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async revokeAllSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.revokeAllSessions(requiredContext(request).userId);
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOkResponse({ type: MeResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(requiredContext(request).userId);
  }

  private setSession(reply: FastifyReply, result: ApplicationAuthSessionResponse) {
    reply.setCookie(this.config.auth.cookieName, result.session.rawToken, {
      ...cookieOptions(this.config),
      maxAge: this.config.auth.idleTimeoutSeconds,
    });
    return {
      user: result.user,
      workspace: result.workspace,
      budget: result.budget,
      csrfToken: result.csrfToken,
    };
  }

  private async optionalSession(request: FastifyRequest): Promise<RequestContext | null> {
    const rawToken = request.cookies[this.config.auth.cookieName];
    return typeof rawToken === 'string' ? this.sessionService.authenticate(rawToken) : null;
  }
}

function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
  };
}

function requiredContext(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

function cookieOptions(config: ApiConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
  };
}
