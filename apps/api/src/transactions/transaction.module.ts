import { PlanOccurrenceRepository } from '../plans/plan-occurrence.repository.js';
import { type DynamicModule, Module } from '@nestjs/common';

import { IncomeAllocationRepository } from '../allocations/income-allocation.repository.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransactionApplicationService } from './transaction.application.service.js';
import { TransactionController } from './transaction.controller.js';
import { TransactionRepository } from './transaction.repository.js';

@Module({})
export class TransactionModule {
  static register(): DynamicModule {
    return {
      module: TransactionModule,
      controllers: [TransactionController],
      providers: [
        {
          provide: TransactionRepository,
          useFactory: (prisma: PrismaService) => new TransactionRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: PlanOccurrenceRepository,
          useFactory: () => new PlanOccurrenceRepository(),
        },
        {
          provide: TransactionApplicationService,
          useFactory: (
            repository: TransactionRepository,
            prisma: PrismaService,
            occurrences: PlanOccurrenceRepository,
          ) =>
             new TransactionApplicationService(
               repository,
               new IdempotencyService(),
               new IncomeAllocationRepository(prisma),
               occurrences,
               new PlanModelPolicy(prisma),
             ),
          inject: [TransactionRepository, PrismaService, PlanOccurrenceRepository],
        },
      ],
    };
  }
}
