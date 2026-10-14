import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { ReportV2ApplicationService } from './report-v2.application.service.js';
import { ReportV2Controller } from './report-v2.controller.js';
import { ReportV2Repository } from './report-v2.repository.js';

@Module({})
export class ReportModule {
  static register(): DynamicModule {
    return {
      module: ReportModule,
      controllers: [ReportV2Controller],
      providers: [
        {
          provide: ReportV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new ReportV2ApplicationService(
              prisma,
              new ReportV2Repository(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
