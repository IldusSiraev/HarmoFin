import { type DynamicModule, Module } from '@nestjs/common';

import { EMAIL_SENDER, type EmailSender } from '../auth/email-sender.js';
import { TokenService } from '../auth/token.service.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { FamilyController } from './family.controller.js';
import { FamilyRepository } from './family.repository.js';
import { InvitationsApplicationService } from './invitations.application.service.js';
import { MembersApplicationService } from './members.application.service.js';

// AuthModule is @Global(), so TokenService, EMAIL_SENDER and API_CONFIG are
// already resolvable here without re-declaring them as providers.
// AuthRateLimitGuard and CsrfGuard are also exported by AuthModule and reused
// via @UseGuards in FamilyController, but Nest instantiates guard classes
// listed in @UseGuards per owning module: FamilyModule gets its own
// AuthRateLimitGuard instance (shared by all family routes within this
// module), separate from AuthModule's instance used by auth routes.
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
        {
          provide: InvitationsApplicationService,
          useFactory: (
            repository: FamilyRepository,
            tokens: TokenService,
            email: EmailSender,
            config: Pick<ApiConfig, 'mail'>,
          ) => new InvitationsApplicationService(repository, tokens, email, config),
          inject: [FamilyRepository, TokenService, EMAIL_SENDER, API_CONFIG],
        },
      ],
      exports: [MembersApplicationService, InvitationsApplicationService, FamilyRepository],
    };
  }
}
