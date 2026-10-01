import { DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { ObligationApplicationService } from './obligation.application.service.js';
import { ObligationController } from './obligation.controller.js';
import { ObligationPlanApplicationService } from './obligation-plan.application.service.js';
import { ObligationPlanController } from './obligation-plan.controller.js';

@Module({})
export class ObligationModule {
  static register(): DynamicModule {
    return {
      module: ObligationModule,
      controllers: [ObligationController, ObligationPlanController],
      providers: [
        {
          provide: ObligationPlanApplicationService,
          useFactory: (prisma: PrismaService) =>
            new ObligationPlanApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: ObligationApplicationService,
          useFactory: (prisma: PrismaService) =>
            new ObligationApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [ObligationApplicationService],
    };
  }
}
