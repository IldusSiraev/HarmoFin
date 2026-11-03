import { type DynamicModule, Module } from '@nestjs/common';

import { TokenService } from '../auth/token.service.js';
import { CalendarApplicationService } from '../calendar/calendar.application.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlansCalendarApplicationService } from '../plans-calendar/plans-calendar.application.service.js';
import { TransactionV2ApplicationService } from '../v2-transactions/transaction-v2.application.service.js';
import { DirectTransferApplicationService } from '../v2-transfers/direct-transfer.application.service.js';
import { TelegramBotRepository } from './bot/telegram-bot.repository.js';
import { TelegramCommandService } from './bot/telegram-command.service.js';
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
          // Services are built here as their own modules build them: importing those modules a
          // second time would register their controllers twice.
          provide: TelegramCommandService,
          useFactory: (
            prisma: PrismaService,
            bot: TelegramBotClient | null,
          ): TelegramCommandService | null =>
            bot
              ? new TelegramCommandService(
                  new TelegramBotRepository(prisma),
                  bot,
                  {
                    transactions: new TransactionV2ApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                    ),
                    transfers: new DirectTransferApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                    ),
                    calendar: new CalendarApplicationService(
                      prisma,
                      new IdempotencyService(),
                      new PlanModelPolicy(prisma),
                      new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
                    ),
                  },
                  config.mail.webBaseUrl,
                )
              : null,
          inject: [PrismaService, TELEGRAM_BOT_CLIENT],
        },
        {
          provide: TelegramLinkApplicationService,
          useFactory: (
            repository: TelegramRepository,
            tokens: TokenService,
            bot: TelegramBotClient | null,
            commands: TelegramCommandService | null,
          ) => new TelegramLinkApplicationService(repository, tokens, bot, config, commands),
          inject: [TelegramRepository, TokenService, TELEGRAM_BOT_CLIENT, TelegramCommandService],
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
