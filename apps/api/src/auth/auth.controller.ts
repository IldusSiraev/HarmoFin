import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import type { ApiConfig } from '../config/env.js';
import { AuthApplicationService, type AuthSessionResponse, type RequestMeta } from './auth.application.service.js';
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

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthApplicationService) private readonly authService: AuthApplicationService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('auth/register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.register(input, requestMeta(request));
    return this.setSession(reply, result);
  }

  @Post('auth/login')
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
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const context = requiredContext(request);
    await this.authService.logout(context.userId, context.sessionId);
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Post('auth/recovery/request')
  @HttpCode(202)
  async requestRecovery(
    @Body(new ZodValidationPipe(recoveryRequestSchema)) input: RecoveryRequestInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.authService.requestRecovery(input.email, requestMeta(request));
  }

  @Post('auth/recovery/confirm')
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
  async csrf(@Req() request: AuthenticatedRequest) {
    const context = requiredContext(request);
    return { csrfToken: await this.authService.rotateCsrfToken(context.userId, context.sessionId) };
  }

  @Post('auth/password')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) input: ChangePasswordInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const context = requiredContext(request);
    const result = await this.authService.changePassword(context.userId, input, requestMeta(request));
    return this.setSession(reply, result);
  }

  @Get('auth/sessions')
  @UseGuards(SessionAuthGuard)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.authService.listSessions(requiredContext(request).userId);
  }

  @Delete('auth/sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const context = requiredContext(request);
    const { sessionId } = request.params as { sessionId: string };
    await this.authService.revokeSession(context.userId, sessionId);
    if (sessionId === context.sessionId) reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Delete('auth/sessions')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async revokeAllSessions(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.revokeAllSessions(requiredContext(request).userId);
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(requiredContext(request).userId);
  }

  private setSession(reply: FastifyReply, result: AuthSessionResponse) {
    reply.setCookie(this.config.auth.cookieName, result.session.rawToken, {
      ...cookieOptions(this.config),
      maxAge: this.config.auth.idleTimeoutSeconds,
    });
    return { user: result.user, workspace: result.workspace, budget: result.budget, csrfToken: result.csrfToken };
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
