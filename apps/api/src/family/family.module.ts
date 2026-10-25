import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { FamilyController } from './family.controller.js';
import { FamilyRepository } from './family.repository.js';
import { MembersApplicationService } from './members.application.service.js';

@Module({})
export class FamilyModule {
  static register(): DynamicModule {
    return {
      module: FamilyModule,
      controllers: [FamilyController],
      providers: [
        {
          provide: FamilyRepository,
          useFactory: (prisma: PrismaService) => new FamilyRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: MembersApplicationService,
          useFactory: (repository: FamilyRepository) => new MembersApplicationService(repository),
          inject: [FamilyRepository],
        },
      ],
      exports: [MembersApplicationService, FamilyRepository],
    };
  }
}
