import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';
import { LegalConsentRepository } from './legal-consent.repository.js';
import { LegalController } from './legal.controller.js';

@Module({})
export class LegalModule {
  static register(): DynamicModule {
    return {
      module: LegalModule,
      controllers: [LegalController],
      providers: [
        {
          provide: LegalConsentApplicationService,
          useFactory: (prisma: PrismaService) =>
            new LegalConsentApplicationService(new LegalConsentRepository(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
