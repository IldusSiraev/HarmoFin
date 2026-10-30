import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { ActivityFeedApplicationService } from './activity-feed.application.service.js';
import { ActivityFeedController } from './activity-feed.controller.js';

@Module({})
export class ActivityFeedModule {
  static register(): DynamicModule {
    return {
      module: ActivityFeedModule,
      controllers: [ActivityFeedController],
      providers: [
        {
          provide: ActivityFeedApplicationService,
          useFactory: (prisma: PrismaService) =>
            new ActivityFeedApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
