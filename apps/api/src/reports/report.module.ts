import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { ReportApplicationService } from './report.application.service.js';
import { ReportController } from './report.controller.js';
import { ReportRepository } from './report.repository.js';

@Module({})
export class ReportModule {
  static register(): DynamicModule {
    return {
      module: ReportModule,
      controllers: [ReportController],
      providers: [
        {
          provide: ReportRepository,
          useFactory: (prisma: PrismaService) => new ReportRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: ReportApplicationService,
          useFactory: (repository: ReportRepository, prisma: PrismaService) =>
            new ReportApplicationService(repository, new PlanModelPolicy(prisma)),
          inject: [ReportRepository, PrismaService],
        },
      ],
    };
  }
}
