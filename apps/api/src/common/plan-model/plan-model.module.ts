import { type DynamicModule, Global, Module } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { PlanModelPolicy } from './plan-model.policy.js';
import { V2BudgetModelController } from './v2-model.controller.js';

@Global()
@Module({})
export class PlanModelModule {
  static register(): DynamicModule {
    return {
      module: PlanModelModule,
      controllers: [V2BudgetModelController],
      providers: [
        {
          provide: PlanModelPolicy,
          useFactory: (prisma: PrismaService) => new PlanModelPolicy(prisma),
          inject: [PrismaService],
        },
      ],
      exports: [PlanModelPolicy],
    };
  }
}
