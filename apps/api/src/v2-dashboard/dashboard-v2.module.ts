import { DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardV2Controller } from './dashboard-v2.controller.js';
import { DashboardV2ApplicationService } from './dashboard-v2.application.service.js';
import { DashboardV2Repository } from './dashboard-v2.repository.js';
import { OnboardingV2ApplicationService } from './onboarding-v2.application.service.js';
import { OnboardingV2Controller } from './onboarding-v2.controller.js';
import { OnboardingV2Repository } from './onboarding-v2.repository.js';

@Module({})
export class DashboardV2Module {
  static register(): DynamicModule {
    return {
      module: DashboardV2Module,
      controllers: [DashboardV2Controller, OnboardingV2Controller],
      providers: [
        {
          provide: DashboardV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new DashboardV2ApplicationService(
              prisma,
              new PlanModelPolicy(prisma),
              new DashboardV2Repository(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: OnboardingV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new OnboardingV2ApplicationService(
              prisma,
              new PlanModelPolicy(prisma),
              new IdempotencyService(),
              new OnboardingV2Repository(),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [DashboardV2ApplicationService],
    };
  }
}
