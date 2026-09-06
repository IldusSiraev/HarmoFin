import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { AuditApplicationService } from './audit.application.service.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';

@Module({})
export class AuditModule {
  static register(): DynamicModule {
    return {
      module: AuditModule,
      controllers: [AuditController],
      providers: [
        {
          provide: AuditRepository,
          useFactory: (prisma: PrismaService) => new AuditRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: AuditApplicationService,
          useFactory: (repository: AuditRepository) => new AuditApplicationService(repository),
          inject: [AuditRepository],
        },
      ],
    };
  }
}
