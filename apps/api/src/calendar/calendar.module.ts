import { DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlansCalendarApplicationService } from '../plans-calendar/plans-calendar.application.service.js';
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
              // Built here as in PlansCalendarModule: importing that module a second time
              // could register its controller twice.
              new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
            ),
          inject: [PrismaService],
        },
      ],
    };
  }
}
