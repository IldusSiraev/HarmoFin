import { type DynamicModule, Module } from '@nestjs/common';

import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { PushApplicationService } from './push.application.service.js';
import { PushController } from './push.controller.js';
import { PushRepository } from './push.repository.js';

@Module({})
export class PushModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: PushModule,
      controllers: [PushController],
      providers: [
        {
          provide: PushRepository,
          useFactory: (prisma: PrismaService) => new PushRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: PushApplicationService,
          useFactory: (repository: PushRepository) =>
            new PushApplicationService(repository, config.push?.vapidPublicKey ?? null),
          inject: [PushRepository],
        },
      ],
    };
  }
}
