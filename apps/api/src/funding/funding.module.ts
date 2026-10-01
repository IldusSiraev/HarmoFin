import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { FundingPreviewApplicationService } from './funding-preview.application.service.js';
import { FundingController } from './funding.controller.js';
import { IncomeCategorySuggestionApplicationService } from './income-category-suggestion.application.service.js';

@Module({})
export class FundingModule {
  static register(): DynamicModule {
    return {
      module: FundingModule,
      controllers: [FundingController],
      providers: [
        {
          provide: FundingPreviewApplicationService,
          useFactory: (prisma: PrismaService) =>
            new FundingPreviewApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
        {
          provide: IncomeCategorySuggestionApplicationService,
          useFactory: (prisma: PrismaService) =>
            new IncomeCategorySuggestionApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [FundingPreviewApplicationService],
    };
  }
}
