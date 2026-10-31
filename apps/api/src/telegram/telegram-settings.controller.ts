import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  updateEmailSettingsSchema,
  type UpdateEmailSettingsInput,
} from '../notification-settings/notification-settings.schemas.js';
import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import {
  TelegramNotificationSettingsResponse,
  UpdateTelegramNotificationSettingsRequest,
} from './telegram.dto.js';

@ApiTags('notification-settings')
@Controller()
export class TelegramSettingsController {
  constructor(
    @Inject(TelegramSettingsApplicationService)
    private readonly service: TelegramSettingsApplicationService,
  ) {}

  @Get('me/notification-settings/telegram')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки уведомлений в Telegram',
    description:
      'Настройки текущего пользователя; если не сохранялись — значения по умолчанию (выключено). available — бот настроен на сервере, linked — чат привязан. Коды: 401.',
  })
  @ApiOkResponse({ type: TelegramNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    return this.service.get(requiredContext(request).userId);
  }

  @Put('me/notification-settings/telegram')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки уведомлений в Telegram',
    description:
      'Включить канал можно только с привязанным чатом. Включение сумм требует amountsConsent: true (своё согласие, не общее с почтой). Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 TELEGRAM_NOT_LINKED, 422 AMOUNTS_CONSENT_REQUIRED.',
  })
  @ApiBody({ type: UpdateTelegramNotificationSettingsRequest })
  @ApiOkResponse({ type: TelegramNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updateEmailSettingsSchema)) input: UpdateEmailSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const meta = requestMeta(request);
    return this.service.update(
      requiredContext(request).userId,
      input,
      meta.requestId ? { requestId: meta.requestId } : {},
    );
  }
}
