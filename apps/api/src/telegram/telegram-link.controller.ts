import { Body, Controller, Delete, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
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
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';
import { CreateTelegramLinkRequest, TelegramLinkResponse } from './telegram.dto.js';
import { createTelegramLinkSchema, type CreateTelegramLinkInput } from './telegram.schemas.js';

const metaOf = (request: AuthenticatedRequest) => {
  const meta = requestMeta(request);
  return meta.requestId ? { requestId: meta.requestId } : {};
};

@ApiTags('telegram')
@Controller()
export class TelegramLinkController {
  constructor(
    @Inject(TelegramLinkApplicationService)
    private readonly service: TelegramLinkApplicationService,
  ) {}

  @Post('me/telegram/link')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Получить ссылку привязки Telegram',
    description:
      'Выдаёт одноразовую ссылку на бота на 15 минут и гасит прежние неиспользованные. Требует согласия. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 TELEGRAM_UNAVAILABLE, 422 TELEGRAM_CONSENT_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: CreateTelegramLinkRequest })
  @ApiOkResponse({ type: TelegramLinkResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  create(
    @Body(new ZodValidationPipe(createTelegramLinkSchema)) input: CreateTelegramLinkInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.issueLink(requiredContext(request).userId, input.consent, metaOf(request));
  }

  @Delete('me/telegram/link')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отвязать Telegram',
    description:
      'Удаляет привязку чата, выключает канал Telegram и отменяет неотправленные сообщения. Без привязки — тоже 204. Коды: 401, 403 CSRF_INVALID.',
  })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async remove(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.service.unlinkFromWeb(requiredContext(request).userId, metaOf(request));
  }
}
