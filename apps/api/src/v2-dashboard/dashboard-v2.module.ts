import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardV2ApplicationService } from './dashboard-v2.application.service.js';
import { DashboardV2Repository } from './dashboard-v2.repository.js';

/** Service only; the HTTP contract of the v2 dashboard is added by P02. */
@Module({})
export class DashboardV2Module {
  static register(): DynamicModule {
    return {
      module: DashboardV2Module,
      providers: [
        {
          provide: DashboardV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new DashboardV2ApplicationService(
              prisma,
              new PlanModelPolicy(prisma),
              new DashboardV2Repository(prisma),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [DashboardV2ApplicationService],
    };
  }
}
