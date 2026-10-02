import { DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { DashboardV2ApplicationService } from '../v2-dashboard/dashboard-v2.application.service.js';
import { DashboardV2Repository } from '../v2-dashboard/dashboard-v2.repository.js';
import { LegacyCorrectionApplicationService } from './legacy-correction.application.service.js';
import { LegacyCorrectionController } from './legacy-correction.controller.js';
import { TransactionV2ApplicationService } from './transaction-v2.application.service.js';
import { TransactionV2Controller } from './transaction-v2.controller.js';

@Module({})
export class TransactionV2Module {
  static register(): DynamicModule {
    return {
      module: TransactionV2Module,
      controllers: [TransactionV2Controller, LegacyCorrectionController],
      providers: [
        {
          provide: TransactionV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new TransactionV2ApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: LegacyCorrectionApplicationService,
          useFactory: (prisma: PrismaService) => {
            const policy = new PlanModelPolicy(prisma);
            return new LegacyCorrectionApplicationService(
              prisma,
              new IdempotencyService(),
              policy,
              new DashboardV2ApplicationService(prisma, policy, new DashboardV2Repository(prisma)),
            );
          },
          inject: [PrismaService],
        },
      ],
      exports: [TransactionV2ApplicationService],
    };
  }
}
