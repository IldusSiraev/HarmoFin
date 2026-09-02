import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { WorkspaceApplicationService } from './workspace.application.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceRepository } from './workspace.repository.js';

@Module({})
export class WorkspaceModule {
  static register(): DynamicModule {
    return {
      module: WorkspaceModule,
      controllers: [WorkspaceController],
      providers: [
        {
          provide: WorkspaceRepository,
          useFactory: (prisma: PrismaService) => new WorkspaceRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: WorkspaceApplicationService,
          useFactory: (repository: WorkspaceRepository) =>
            new WorkspaceApplicationService(repository),
          inject: [WorkspaceRepository],
        },
      ],
      exports: [WorkspaceApplicationService, WorkspaceRepository],
    };
  }
}
