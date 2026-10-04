import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlansCalendarApplicationService } from './plans-calendar.application.service.js';
import { PlansCalendarController } from './plans-calendar.controller.js';

@Module({})
export class PlansCalendarModule {
  static register(): DynamicModule {
    return {
      module: PlansCalendarModule,
      controllers: [PlansCalendarController],
      providers: [
        {
          provide: PlansCalendarApplicationService,
          useFactory: (prisma: PrismaService) =>
            new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
