import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { CycleRevisionApplicationService } from './cycle-revision.application.service.js';
import { CycleRevisionController } from './cycle-revision.controller.js';
import { CycleApplicationService } from './cycle.application.service.js';
import { CycleController } from './cycle.controller.js';
import { CycleRepository } from './cycle.repository.js';

@Module({})
export class CycleModule {
  static register(): DynamicModule {
    return {
      module: CycleModule,
      controllers: [CycleController, CycleRevisionController],
      providers: [
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
        {
          provide: CycleRepository,
          useFactory: (prisma: PrismaService) => new CycleRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: CycleApplicationService,
          useFactory: (repository: CycleRepository) => new CycleApplicationService(repository),
          inject: [CycleRepository],
        },
      ],
    };
  }
}
