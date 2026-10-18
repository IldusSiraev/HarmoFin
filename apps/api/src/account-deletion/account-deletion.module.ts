import { type DynamicModule, Module } from '@nestjs/common';

import { EMAIL_SENDER, type EmailSender } from '../auth/email-sender.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { AccountDeletionApplicationService } from './account-deletion.application.service.js';
import { AccountDeletionController } from './account-deletion.controller.js';
import { AccountDeletionRepository } from './account-deletion.repository.js';

@Module({})
export class AccountDeletionModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AccountDeletionModule,
      controllers: [AccountDeletionController],
      providers: [
        {
          provide: AccountDeletionApplicationService,
          useFactory: (
            prisma: PrismaService,
            password: PasswordService,
            tokens: TokenService,
            emailSender: EmailSender,
          ) =>
            new AccountDeletionApplicationService(
              new AccountDeletionRepository(prisma),
              password,
              tokens,
              emailSender,
              config,
            ),
          inject: [PrismaService, PasswordService, TokenService, EMAIL_SENDER],
        },
      ],
    };
  }
}
