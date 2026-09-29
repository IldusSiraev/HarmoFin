import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransferApplicationService } from './transfer.application.service.js';
import { TransferController } from './transfer.controller.js';
import { TransferRepository } from './transfer.repository.js';

@Module({})
export class TransferModule {
  static register(): DynamicModule {
    return {
      module: TransferModule,
      controllers: [TransferController],
      providers: [
        {
          provide: TransferRepository,
          useFactory: (prisma: PrismaService) => new TransferRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TransferApplicationService,
          useFactory: (repository: TransferRepository, prisma: PrismaService) =>
            new TransferApplicationService(
              repository,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [TransferRepository, PrismaService],
        },
      ],
    };
  }
}
