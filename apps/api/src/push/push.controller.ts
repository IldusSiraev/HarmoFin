import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PushApplicationService } from './push.application.service.js';
import {
  CreatePushSubscriptionRequest,
  PushNotificationSettingsResponse,
  UpdatePushNotificationSettingsRequest,
} from './push.dto.js';
import {
  createPushSubscriptionSchema,
  pushSubscriptionIdSchema,
  updatePushSettingsSchema,
  type CreatePushSubscriptionInput,
  type UpdatePushSettingsInput,
} from './push.schemas.js';

const metaOf = (request: AuthenticatedRequest) => {
  const meta = requestMeta(request);
  return {
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
  };
};

@ApiTags('notification-settings')
@Controller()
export class PushController {
  constructor(
    @Inject(PushApplicationService)
    private readonly service: PushApplicationService,
  ) {}

  @Get('me/notification-settings/push')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки push-уведомлений',
    description:
      'Настройки текущего пользователя (по умолчанию выключено, оба типа включены), публичный VAPID-ключ и устройства активных сессий. Коды: 401.',
  })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    const context = requiredContext(request);
    return this.service.get(context.userId, context.sessionId);
  }

  @Put('me/notification-settings/push')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки push-уведомлений',
    description:
      'Главный переключатель и типы: просроченный платёж, напоминание календаря. Включить можно только с устройством. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 PUSH_NO_DEVICES.',
  })
  @ApiBody({ type: UpdatePushNotificationSettingsRequest })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updatePushSettingsSchema)) input: UpdatePushSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = requiredContext(request);
    return this.service.update(context.userId, context.sessionId, input, metaOf(request));
  }

  @Post('me/push/subscriptions')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Подключить это устройство к push-уведомлениям',
    description:
      'Сохраняет подписку браузера для текущей сессии и включает канал. Тот же адрес у другого пользователя переходит к текущему. Не больше 10 устройств: лишние, самые старые, удаляются. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 PUSH_UNAVAILABLE, 422 PUSH_ENDPOINT_NOT_ALLOWED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: CreatePushSubscriptionRequest })
  @ApiOkResponse({ type: PushNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  subscribe(
    @Body(new ZodValidationPipe(createPushSubscriptionSchema)) input: CreatePushSubscriptionInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = requiredContext(request);
    return this.service.subscribe(context.userId, context.sessionId, input, metaOf(request));
  }

  @Delete('me/push/subscriptions/:subscriptionId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отключить устройство от push-уведомлений',
    description:
      'Удаляет своё устройство; последнее устройство выключает канал. Чужое или несуществующее — тоже 204. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID.',
  })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async remove(
    @Param('subscriptionId', new ZodValidationPipe(pushSubscriptionIdSchema))
    subscriptionId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.unsubscribe(
      requiredContext(request).userId,
      subscriptionId,
      metaOf(request),
    );
  }
}
