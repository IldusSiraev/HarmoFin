import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LegacyCorrectionApplicationService } from './legacy-correction.application.service.js';
import {
  LegacyCorrectionBody,
  LegacyCorrectionPreviewBody,
  LegacyCorrectionPreviewResponse,
  LegacyCorrectionResponse,
} from './legacy-correction.dto.js';
import {
  budgetIdParamSchema,
  legacyCorrectionPreviewSchema,
  legacyCorrectionSchema,
  transactionIdParamSchema,
  type LegacyCorrectionInput,
  type LegacyCorrectionPreviewInput,
} from './legacy-correction.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный ключ идемпотентности.',
      fieldErrors: [
        { field: 'Idempotency-Key', message: 'Укажите корректный ключ.', code: 'invalid' },
      ],
    });
  }
  return key;
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

@ApiTags('history (v2)')
@Controller({ path: 'budgets/:budgetId/history', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class LegacyCorrectionController {
  constructor(
    @Inject(LegacyCorrectionApplicationService)
    private readonly service: LegacyCorrectionApplicationService,
  ) {}

  @Post(':transactionId/correction-preview')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Предпросмотр исправления старой физической операции',
    description:
      'Только владелец. Ничего не сохраняет: возвращает изменение денег, новый безопасный остаток из сводки v2, связанные распределения доходов модели 1 и previewHash.',
  })
  @ApiBody({ type: LegacyCorrectionPreviewBody })
  @ApiOkResponse({ type: LegacyCorrectionPreviewResponse })
  @ApiResponse({
    status: 400,
    description: 'Ошибка валидации: VALIDATION_FAILED (тело, параметры).',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Нет действующей сессии.',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: действие доступно только владельцу (OWNER).',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'RESOURCE_NOT_FOUND: бюджет или операция не найдены в этом бюджете.',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 409,
    description:
      'Конфликт состояния: MODEL_VERSION_MISMATCH, NOT_LEGACY_FACT (факт модели 2), TRANSACTION_NOT_EDITABLE (не подтверждённая или удалённая операция), INSUFFICIENT_BALANCE (cash счёта станет отрицательным).',
    type: ProblemDetailsResponse,
  })
  preview(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(legacyCorrectionPreviewSchema))
    input: LegacyCorrectionPreviewInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.preview(
      contextOf(request).userId,
      budgetId,
      transactionId,
      input,
      request.id,
    );
  }

  @Post(':transactionId/correct')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Исправить старую физическую операцию после перехода',
    description:
      'Только владелец. В одной транзакции: блокировка бюджета, пересчёт предпросмотра и сверка previewHash, изменение факта, явное решение по связанным распределениям доходов модели 1 (CANCEL или DELETE), аудит. Новые назначения v2 не переписываются.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: LegacyCorrectionBody })
  @ApiOkResponse({ type: LegacyCorrectionResponse })
  @ApiResponse({
    status: 400,
    description:
      'Ошибка валидации: VALIDATION_FAILED (тело, параметры, заголовок Idempotency-Key).',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Нет действующей сессии.',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN: действие доступно только владельцу (OWNER).',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'RESOURCE_NOT_FOUND: бюджет или операция не найдены в этом бюджете.',
    type: ProblemDetailsResponse,
  })
  @ApiResponse({
    status: 409,
    description:
      'Конфликт состояния: MODEL_VERSION_MISMATCH, NOT_LEGACY_FACT, TRANSACTION_NOT_EDITABLE, INSUFFICIENT_BALANCE, PREVIEW_STALE (данные изменились после предпросмотра), ALLOCATION_RESOLUTION_REQUIRED, ALLOCATION_RESOLUTION_NOT_REQUIRED, INVALID_TRANSACTION_STATE (распределение уже не CONFIRMED), IDEMPOTENCY_CONFLICT (ключ уже использован для другого запроса).',
    type: ProblemDetailsResponse,
  })
  correct(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(legacyCorrectionSchema)) input: LegacyCorrectionInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.correct(
      contextOf(request).userId,
      budgetId,
      transactionId,
      input,
      validKey(key),
      request.id,
    );
  }
}
