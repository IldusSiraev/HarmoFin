import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { AccountApplicationService } from './account.application.service.js';
import { AccountController } from './account.controller.js';
import { AccountRepository } from './account.repository.js';

@Module({})
export class AccountModule {
  static register(): DynamicModule {
    return {
      module: AccountModule,
      controllers: [AccountController],
      providers: [
        {
          provide: AccountRepository,
          useFactory: (prisma: PrismaService) => new AccountRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: AccountApplicationService,
          useFactory: (repository: AccountRepository) => new AccountApplicationService(repository),
          inject: [AccountRepository],
        },
      ],
    };
  }
}
