import { DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { ObligationApplicationService } from './obligation.application.service.js';
import { ObligationController } from './obligation.controller.js';

@Module({})
export class ObligationModule {
  static register(): DynamicModule {
    return {
      module: ObligationModule,
      controllers: [ObligationController],
      providers: [
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
