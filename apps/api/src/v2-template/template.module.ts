import { type DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
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
      ],
      exports: [TemplatePreviewApplicationService],
    };
  }
}
