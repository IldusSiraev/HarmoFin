import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { ExternalWebhook } from '../common/security/external-webhook.decorator.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';

@ApiTags('telegram')
@Controller()
export class TelegramWebhookController {
  constructor(
    @Inject(TelegramLinkApplicationService)
    private readonly service: TelegramLinkApplicationService,
  ) {}

  @Post('telegram/webhook')
  @HttpCode(200)
  @ExternalWebhook()
  @ApiOperation({
    summary: 'Webhook Telegram-бота',
    description:
      'Вызывается серверами Telegram без сессии, CSRF и Origin; вызывающий проверяется заголовком X-Telegram-Bot-Api-Secret-Token. Нераспознанные обновления тоже получают 200. Коды: 401 TELEGRAM_WEBHOOK_UNAUTHORIZED, 404 RESOURCE_NOT_FOUND (бот не настроен).',
  })
  @ApiHeader({ name: 'X-Telegram-Bot-Api-Secret-Token', required: true })
  @ApiBody({ schema: { type: 'object', description: 'Update из Telegram Bot API.' } })
  @ApiOkResponse({ description: 'Обновление принято.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  async receive(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ): Promise<void> {
    if (!this.service.available) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
    }
    if (!this.service.webhookSecretValid(secret)) {
      throw new UnauthorizedException({
        code: 'TELEGRAM_WEBHOOK_UNAUTHORIZED',
        detail: 'Неверный секрет webhook.',
      });
    }
    await this.service.handleUpdate(update);
  }
}
