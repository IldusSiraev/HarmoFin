import { type DynamicModule, Global, Module } from '@nestjs/common';

import { API_CONFIG } from '../common/security/security.constants.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthApplicationService } from './auth.application.service.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthRepository } from './auth.repository.js';
import { EmailVerificationApplicationService } from './email-verification.application.service.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { MetricsRegistry } from '../observability/observability.js';
import { EMAIL_SENDER, type EmailSender } from './email-sender.js';
import { PasswordService } from './password.service.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionService } from './session.service.js';
import { SmtpEmailSender } from './smtp-email.sender.js';
import { TokenService } from './token.service.js';

@Global()
@Module({})
export class AuthModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController, EmailVerificationController],
      providers: [
        { provide: API_CONFIG, useValue: config },
        PasswordService,
        { provide: TokenService, useFactory: () => new TokenService(config.auth.tokenHashSecret) },
        {
          provide: PrismaSessionStore,
          useFactory: (prisma: PrismaService) => new PrismaSessionStore(prisma),
          inject: [PrismaService],
        },
        {
          provide: SessionService,
          useFactory: (store: PrismaSessionStore, tokens: TokenService) =>
            new SessionService(store, tokens),
          inject: [PrismaSessionStore, TokenService],
        },
        {
          provide: AuthRepository,
          useFactory: (prisma: PrismaService) => new AuthRepository(prisma),
          inject: [PrismaService],
        },
        { provide: EMAIL_SENDER, useFactory: () => new SmtpEmailSender(config) },
        {
          provide: EmailVerificationApplicationService,
          useFactory: (prisma: PrismaService, tokens: TokenService, emailSender: EmailSender) =>
            new EmailVerificationApplicationService(prisma, tokens, emailSender, config),
          inject: [PrismaService, TokenService, EMAIL_SENDER],
        },
        {
          provide: AuthApplicationService,
          useFactory: (
            repository: AuthRepository,
            password: PasswordService,
            tokens: TokenService,
            sessions: SessionService,
            emailSender: SmtpEmailSender,
            metrics: MetricsRegistry,
          ) =>
            new AuthApplicationService(
              repository,
              password,
              tokens,
              sessions,
              emailSender,
              config,
              metrics,
            ),
          inject: [
            AuthRepository,
            PasswordService,
            TokenService,
            SessionService,
            EMAIL_SENDER,
            MetricsRegistry,
          ],
        },
        AuthRateLimitGuard,
        SessionAuthGuard,
        CsrfGuard,
      ],
      exports: [
        API_CONFIG,
        SessionAuthGuard,
        CsrfGuard,
        SessionService,
        AuthApplicationService,
        TokenService,
        PasswordService,
        EMAIL_SENDER,
        AuthRateLimitGuard,
      ],
    };
  }
}
