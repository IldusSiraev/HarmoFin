import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
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
          useFactory: (repository: EnvelopeReallocationRepository) =>
            new EnvelopeReallocationApplicationService(repository, new IdempotencyService()),
          inject: [EnvelopeReallocationRepository],
        },
      ],
    };
  }
}
