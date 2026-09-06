import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { CycleApplicationService } from './cycle.application.service.js';
import { CycleController } from './cycle.controller.js';
import { CycleRepository } from './cycle.repository.js';

@Module({})
export class CycleModule {
  static register(): DynamicModule {
    return {
      module: CycleModule,
      controllers: [CycleController],
      providers: [
        {
          provide: CycleRepository,
          useFactory: (prisma: PrismaService) => new CycleRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: CycleApplicationService,
          useFactory: (repository: CycleRepository) => new CycleApplicationService(repository),
          inject: [CycleRepository],
        },
      ],
    };
  }
}
