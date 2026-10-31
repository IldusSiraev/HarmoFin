import { type DynamicModule, Module } from '@nestjs/common';

import { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  HttpTelegramBotClient,
  TELEGRAM_BOT_CLIENT,
  type TelegramBotClient,
} from './telegram-bot.client.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';
import { TelegramLinkController } from './telegram-link.controller.js';
import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import { TelegramSettingsController } from './telegram-settings.controller.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';
import { TelegramRepository } from './telegram.repository.js';

@Module({})
export class TelegramModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: TelegramModule,
      controllers: [TelegramLinkController, TelegramWebhookController, TelegramSettingsController],
      providers: [
        {
          provide: TelegramRepository,
          useFactory: (prisma: PrismaService) => new TelegramRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TELEGRAM_BOT_CLIENT,
          useFactory: (): TelegramBotClient | null =>
            config.telegram
              ? new HttpTelegramBotClient(config.telegram.botToken, config.telegram.apiBaseUrl)
              : null,
        },
        {
          provide: TelegramLinkApplicationService,
          useFactory: (
            repository: TelegramRepository,
            tokens: TokenService,
            bot: TelegramBotClient | null,
          ) => new TelegramLinkApplicationService(repository, tokens, bot, config),
          inject: [TelegramRepository, TokenService, TELEGRAM_BOT_CLIENT],
        },
        {
          provide: TelegramSettingsApplicationService,
          useFactory: (repository: TelegramRepository) =>
            new TelegramSettingsApplicationService(repository, config.telegram !== undefined),
          inject: [TelegramRepository],
        },
      ],
      exports: [TelegramRepository],
    };
  }
}
