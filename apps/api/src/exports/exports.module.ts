import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { MetricsRegistry } from '../observability/observability.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { LegacyAssignmentHistoryRepository } from '../reports/legacy-assignment-history.repository.js';
import { CsvExportV2ApplicationService } from './csv-export-v2.application.service.js';
import { CsvExportV2Repository } from './csv-export-v2.repository.js';
import { CsvExportApplicationService } from './csv-export.application.service.js';
import { ExportsV2Controller } from './exports-v2.controller.js';
import { ExportsController } from './exports.controller.js';
import { CsvExportRepository } from './csv-export.repository.js';

@Module({})
export class ExportsModule {
  static register(): DynamicModule {
    return {
      module: ExportsModule,
      controllers: [ExportsController, ExportsV2Controller],
      providers: [
        {
          provide: CsvExportRepository,
          useFactory: (prisma: PrismaService) =>
            new CsvExportRepository(prisma, new TransactionRepository(prisma)),
          inject: [PrismaService],
        },
        {
          provide: CsvExportApplicationService,
          useFactory: (
            repository: CsvExportRepository,
            metrics: MetricsRegistry,
            prisma: PrismaService,
          ) => new CsvExportApplicationService(repository, metrics, new PlanModelPolicy(prisma)),
          inject: [CsvExportRepository, MetricsRegistry, PrismaService],
        },
        {
          provide: CsvExportV2ApplicationService,
          useFactory: (prisma: PrismaService, metrics: MetricsRegistry) =>
            new CsvExportV2ApplicationService(
              prisma,
              new CsvExportV2Repository(),
              new LegacyAssignmentHistoryRepository(),
              metrics,
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService, MetricsRegistry],
        },
      ],
    };
  }
}
