import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import { NotificationSettingsController } from './notification-settings.controller.js';
import { NotificationSettingsRepository } from './notification-settings.repository.js';

@Module({})
export class NotificationSettingsModule {
  static register(): DynamicModule {
    return {
      module: NotificationSettingsModule,
      controllers: [NotificationSettingsController],
      providers: [
        {
          provide: NotificationSettingsApplicationService,
          useFactory: (prisma: PrismaService) =>
            new NotificationSettingsApplicationService(new NotificationSettingsRepository(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
