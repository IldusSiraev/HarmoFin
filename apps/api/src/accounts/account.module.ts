import { type DynamicModule, Module } from '@nestjs/common';

import { RolePolicy } from '../common/policies/role-policy.js';
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
        RolePolicy,
        {
          provide: AccountRepository,
          useFactory: (prisma: PrismaService) => new AccountRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: AccountApplicationService,
          useFactory: (repository: AccountRepository, rolePolicy: RolePolicy) =>
            new AccountApplicationService(repository, rolePolicy),
          inject: [AccountRepository, RolePolicy],
        },
      ],
    };
  }
}
