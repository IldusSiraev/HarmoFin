import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { MetricsRegistry } from '../observability/observability.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { CsvExportApplicationService } from './csv-export.application.service.js';
import { ExportsController } from './exports.controller.js';
import { CsvExportRepository } from './csv-export.repository.js';

@Module({})
export class ExportsModule {
  static register(): DynamicModule {
    return {
      module: ExportsModule,
      controllers: [ExportsController],
      providers: [
        {
          provide: CsvExportRepository,
          useFactory: (prisma: PrismaService) =>
            new CsvExportRepository(prisma, new TransactionRepository(prisma)),
          inject: [PrismaService],
        },
        {
          provide: CsvExportApplicationService,
          useFactory: (repository: CsvExportRepository, metrics: MetricsRegistry) =>
            new CsvExportApplicationService(repository, metrics),
          inject: [CsvExportRepository, MetricsRegistry],
        },
      ],
    };
  }
}
