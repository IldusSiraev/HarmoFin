import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationApplicationService } from './notification.application.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationRepository } from './notification.repository.js';

@Module({})
export class NotificationsModule {
  static register(): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationRepository,
          useFactory: (prisma: PrismaService) => new NotificationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: NotificationApplicationService,
          useFactory: (repository: NotificationRepository) =>
            new NotificationApplicationService(repository, new IdempotencyService()),
          inject: [NotificationRepository],
        },
      ],
    };
  }
}
