import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { BudgetApplicationService } from './budget.application.service.js';
import { BudgetController } from './budget.controller.js';
import { BudgetRepository } from './budget.repository.js';

@Module({})
export class BudgetModule {
  static register(): DynamicModule {
    return {
      module: BudgetModule,
      controllers: [BudgetController],
      providers: [
        {
          provide: BudgetRepository,
          useFactory: (prisma: PrismaService) => new BudgetRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: BudgetApplicationService,
          useFactory: (repository: BudgetRepository) => new BudgetApplicationService(repository),
          inject: [BudgetRepository],
        },
      ],
    };
  }
}
