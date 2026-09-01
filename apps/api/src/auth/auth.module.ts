import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../common/security/security.constants.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthApplicationService } from './auth.application.service.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { EMAIL_SENDER } from './email-sender.js';
import { PasswordService } from './password.service.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionService } from './session.service.js';
import { SmtpEmailSender } from './smtp-email.sender.js';
import { TokenService } from './token.service.js';

@Module({})
export class AuthModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
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
          useFactory: (store: PrismaSessionStore, tokens: TokenService) => new SessionService(store, tokens),
          inject: [PrismaSessionStore, TokenService],
        },
        {
          provide: AuthRepository,
          useFactory: (prisma: PrismaService) => new AuthRepository(prisma),
          inject: [PrismaService],
        },
        { provide: EMAIL_SENDER, useFactory: () => new SmtpEmailSender(config) },
        {
          provide: AuthApplicationService,
          useFactory: (
            repository: AuthRepository,
            password: PasswordService,
            tokens: TokenService,
            sessions: SessionService,
            emailSender: SmtpEmailSender,
          ) => new AuthApplicationService(repository, password, tokens, sessions, emailSender, config),
          inject: [AuthRepository, PasswordService, TokenService, SessionService, EMAIL_SENDER],
        },
        SessionAuthGuard,
        CsrfGuard,
      ],
      exports: [SessionAuthGuard, CsrfGuard, SessionService, AuthApplicationService],
    };
  }
}
