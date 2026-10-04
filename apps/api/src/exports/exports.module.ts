import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { MetricsRegistry } from '../observability/observability.js';
import { CsvExportV2ApplicationService } from './csv-export-v2.application.service.js';
import { CsvExportV2Repository } from './csv-export-v2.repository.js';
import { ExportsV2Controller } from './exports-v2.controller.js';

@Module({})
export class ExportsModule {
  static register(): DynamicModule {
    return {
      module: ExportsModule,
      controllers: [ExportsV2Controller],
      providers: [
        {
          provide: CsvExportV2ApplicationService,
          useFactory: (prisma: PrismaService, metrics: MetricsRegistry) =>
            new CsvExportV2ApplicationService(
              prisma,
              new CsvExportV2Repository(),
              metrics,
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService, MetricsRegistry],
        },
      ],
    };
  }
}
