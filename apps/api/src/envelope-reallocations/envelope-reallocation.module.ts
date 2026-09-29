import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import { EnvelopeReallocationController } from './envelope-reallocation.controller.js';
import { EnvelopeReallocationRepository } from './envelope-reallocation.repository.js';

@Module({})
export class EnvelopeReallocationModule {
  static register(): DynamicModule {
    return {
      module: EnvelopeReallocationModule,
      controllers: [EnvelopeReallocationController],
      providers: [
        {
          provide: EnvelopeReallocationRepository,
          useFactory: (prisma: PrismaService) => new EnvelopeReallocationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: EnvelopeReallocationApplicationService,
          useFactory: (repository: EnvelopeReallocationRepository, prisma: PrismaService) =>
            new EnvelopeReallocationApplicationService(
              repository,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [EnvelopeReallocationRepository, PrismaService],
        },
      ],
    };
  }
}
