import { DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { DirectTransferApplicationService } from './direct-transfer.application.service.js';
import { DirectTransferController } from './direct-transfer.controller.js';

@Module({})
export class DirectTransferModule {
  static register(): DynamicModule {
    return {
      module: DirectTransferModule,
      controllers: [DirectTransferController],
      providers: [
        {
          provide: DirectTransferApplicationService,
          useFactory: (prisma: PrismaService) =>
            new DirectTransferApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [DirectTransferApplicationService],
    };
  }
}
