import { DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { CalendarApplicationService } from './calendar.application.service.js';
import { CalendarController } from './calendar.controller.js';

@Module({})
export class CalendarModule {
  static register(): DynamicModule {
    return {
      module: CalendarModule,
      controllers: [CalendarController],
      providers: [
        {
          provide: CalendarApplicationService,
          useFactory: (prisma: PrismaService) =>
            new CalendarApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
