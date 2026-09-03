import { type DynamicModule, Module } from '@nestjs/common';

import { RolePolicy } from '../common/policies/role-policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { EnvelopeApplicationService } from './envelope.application.service.js';
import { EnvelopeController } from './envelope.controller.js';
import { EnvelopeRepository } from './envelope.repository.js';

@Module({})
export class EnvelopeModule {
  static register(): DynamicModule {
    return {
      module: EnvelopeModule,
      controllers: [EnvelopeController],
      providers: [
        RolePolicy,
        {
          provide: EnvelopeRepository,
          useFactory: (prisma: PrismaService) => new EnvelopeRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: EnvelopeApplicationService,
          useFactory: (repository: EnvelopeRepository, rolePolicy: RolePolicy) =>
            new EnvelopeApplicationService(repository, rolePolicy),
          inject: [EnvelopeRepository, RolePolicy],
        },
      ],
    };
  }
}
