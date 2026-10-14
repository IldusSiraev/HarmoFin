import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { CycleRevisionApplicationService } from './cycle-revision.application.service.js';
import { CycleRevisionController } from './cycle-revision.controller.js';
import { V2BudgetSettingsApplicationService } from './v2-budget-settings.application.service.js';
import { V2BudgetSettingsController } from './v2-budget-settings.controller.js';

@Module({})
export class CycleModule {
  static register(): DynamicModule {
    return {
      module: CycleModule,
      controllers: [CycleRevisionController, V2BudgetSettingsController],
      providers: [
        {
          provide: V2BudgetSettingsApplicationService,
          useFactory: (prisma: PrismaService) =>
            new V2BudgetSettingsApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: CycleRevisionApplicationService,
          useFactory: (prisma: PrismaService) =>
            new CycleRevisionApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
