import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { IncomeAllocationApplicationService } from './income-allocation.application.service.js';
import { IncomeAllocationController } from './income-allocation.controller.js';
import { IncomeAllocationRepository } from './income-allocation.repository.js';

@Module({})
export class IncomeAllocationModule {
  static register(): DynamicModule {
    return {
      module: IncomeAllocationModule,
      controllers: [IncomeAllocationController],
      providers: [
        {
          provide: IncomeAllocationRepository,
          useFactory: (prisma: PrismaService) => new IncomeAllocationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: IncomeAllocationApplicationService,
          useFactory: (repository: IncomeAllocationRepository, prisma: PrismaService) =>
            new IncomeAllocationApplicationService(
              repository,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [IncomeAllocationRepository, PrismaService],
        },
      ],
    };
  }
}
