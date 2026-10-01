import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { TemplateApplyApplicationService } from './template-apply.application.service.js';
import { TemplatePreviewApplicationService } from './template-preview.application.service.js';
import { TemplateController } from './template.controller.js';

@Module({})
export class TemplateModule {
  static register(): DynamicModule {
    return {
      module: TemplateModule,
      controllers: [TemplateController],
      providers: [
        {
          provide: TemplatePreviewApplicationService,
          useFactory: (prisma: PrismaService) =>
            new TemplatePreviewApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
        {
          provide: TemplateApplyApplicationService,
          useFactory: (prisma: PrismaService, preview: TemplatePreviewApplicationService) =>
            new TemplateApplyApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
              preview,
            ),
          inject: [PrismaService, TemplatePreviewApplicationService],
        },
      ],
      exports: [TemplatePreviewApplicationService],
    };
  }
}
