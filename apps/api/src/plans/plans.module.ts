import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransactionV2ApplicationService } from '../v2-transactions/transaction-v2.application.service.js';
import { IncomePlanApplicationService } from './income-plan-v2.application.service.js';
import { IncomePlanController } from './income-plan-v2.controller.js';
import { PlanOccurrenceRepository } from './plan-occurrence.repository.js';
import { RegularPlanRepository } from './regular-plan.repository.js';
import { V2OccurrenceMaterializer } from './v2-occurrence-materializer.js';

@Module({})
export class PlansModule {
  static register(): DynamicModule {
    return {
      module: PlansModule,
      controllers: [IncomePlanController],
      providers: [
        {
          provide: RegularPlanRepository,
          useFactory: (prisma: PrismaService) => new RegularPlanRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: PlanOccurrenceRepository,
          useFactory: () => new PlanOccurrenceRepository(),
        },
        {
          provide: V2OccurrenceMaterializer,
          useFactory: (plans: RegularPlanRepository, occurrences: PlanOccurrenceRepository) =>
            new V2OccurrenceMaterializer(plans, occurrences),
          inject: [RegularPlanRepository, PlanOccurrenceRepository],
        },
        {
          provide: IncomePlanApplicationService,
          useFactory: (prisma: PrismaService) => {
            const idempotency = new IdempotencyService();
            const policy = new PlanModelPolicy(prisma);
            return new IncomePlanApplicationService(
              prisma,
              idempotency,
              policy,
              new TransactionV2ApplicationService(prisma, idempotency, policy),
            );
          },
          inject: [PrismaService],
        },
      ],
      exports: [PlanOccurrenceRepository, V2OccurrenceMaterializer],
    };
  }
}
