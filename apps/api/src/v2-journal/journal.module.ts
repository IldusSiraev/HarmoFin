import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { JournalApplicationService } from './journal.application.service.js';
import { JournalController } from './journal.controller.js';
import { JournalRepository } from './journal.repository.js';

@Module({})
export class JournalModule {
  static register(): DynamicModule {
    return {
      module: JournalModule,
      controllers: [JournalController],
      providers: [
        {
          provide: JournalApplicationService,
          useFactory: (prisma: PrismaService) =>
            new JournalApplicationService(
              new TransactionRepository(prisma),
              new JournalRepository(prisma),
              new PlanModelPolicy(prisma),
              prisma,
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
