import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardApplicationService } from './dashboard.application.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';

@Module({})
export class DashboardModule {
  static register(): DynamicModule {
    return {
      module: DashboardModule,
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardRepository,
          useFactory: (prisma: PrismaService) => new DashboardRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: DashboardApplicationService,
          useFactory: (repository: DashboardRepository, prisma: PrismaService) =>
            new DashboardApplicationService(repository, new PlanModelPolicy(prisma)),
          inject: [DashboardRepository, PrismaService],
        },
      ],
    };
  }
}
