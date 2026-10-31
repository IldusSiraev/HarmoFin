import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import {
  EmailNotificationSettingsResponse,
  UnsubscribeRequest,
  UpdateEmailNotificationSettingsRequest,
} from './notification-settings.dto.js';
import {
  unsubscribeSchema,
  updateEmailSettingsSchema,
  type UnsubscribeInput,
  type UpdateEmailSettingsInput,
} from './notification-settings.schemas.js';

const metaOf = (request: FastifyRequest) => {
  const meta = requestMeta(request);
  return meta.requestId ? { requestId: meta.requestId } : {};
};

@ApiTags('notification-settings')
@Controller()
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsApplicationService)
    private readonly service: NotificationSettingsApplicationService,
  ) {}

  @Get('me/notification-settings/email')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки уведомлений на почту',
    description:
      'Настройки текущего пользователя; если не сохранялись — значения по умолчанию (выключено). Адрес частично скрыт. Коды: 401.',
  })
  @ApiOkResponse({ type: EmailNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    return this.service.getEmail(requiredContext(request).userId);
  }

  @Put('me/notification-settings/email')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки уведомлений на почту',
    description:
      'Включить канал можно только с подтверждённой почтой. Включение сумм требует amountsConsent: true; время согласия сохраняется, при выключении сбрасывается. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 EMAIL_NOT_VERIFIED, 422 AMOUNTS_CONSENT_REQUIRED.',
  })
  @ApiBody({ type: UpdateEmailNotificationSettingsRequest })
  @ApiOkResponse({ type: EmailNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updateEmailSettingsSchema)) input: UpdateEmailSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateEmail(requiredContext(request).userId, input, metaOf(request));
  }

  @Post('notifications/unsubscribe')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Отписаться от писем по ссылке',
    description:
      'Публичный: открывается из письма без входа. Без сессии и CSRF; глобальный OriginGuard требует origin веба. Выключает канал получателю письма. Неизвестный токен — тот же ответ 204. Коды: 400 VALIDATION_FAILED, 403 ORIGIN_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: UnsubscribeRequest })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async unsubscribe(
    @Body(new ZodValidationPipe(unsubscribeSchema)) input: UnsubscribeInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.unsubscribe(input.token, metaOf(request));
  }
}
