import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentApplicationService } from './assignment.application.service.js';
import { EnvelopePlanApplicationService } from './envelope-plan.application.service.js';
import { EnvelopePlanController } from './envelope-plan.controller.js';
import { FundingRulesBatchApplicationService } from './funding-rules-batch.application.service.js';
import { MovementApplicationService } from './movement.application.service.js';
import { PeriodTargetApplicationService } from './period-target.application.service.js';

@Module({})
export class EnvelopePlanModule {
  static register(): DynamicModule {
    return {
      module: EnvelopePlanModule,
      controllers: [EnvelopePlanController],
      providers: [
        {
          provide: EnvelopePlanApplicationService,
          useFactory: (prisma: PrismaService) =>
            new EnvelopePlanApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: AssignmentApplicationService,
          useFactory: (prisma: PrismaService) =>
            new AssignmentApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: MovementApplicationService,
          useFactory: (prisma: PrismaService) =>
            new MovementApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: PeriodTargetApplicationService,
          useFactory: (prisma: PrismaService) =>
            new PeriodTargetApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: FundingRulesBatchApplicationService,
          useFactory: (prisma: PrismaService) =>
            new FundingRulesBatchApplicationService(
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
