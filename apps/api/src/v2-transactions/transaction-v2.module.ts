import { DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { TransactionV2ApplicationService } from './transaction-v2.application.service.js';
import { TransactionV2Controller } from './transaction-v2.controller.js';

@Module({})
export class TransactionV2Module {
  static register(): DynamicModule {
    return {
      module: TransactionV2Module,
      controllers: [TransactionV2Controller],
      providers: [
        {
          provide: TransactionV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new TransactionV2ApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [TransactionV2ApplicationService],
    };
  }
}
