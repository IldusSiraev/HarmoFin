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
import { CycleRevisionApplicationService } from './cycle-revision.application.service.js';
import {
  CycleChangeConfirmRequest,
  CycleChangeConfirmResponse,
  CycleChangePreviewRequest,
  CycleChangePreviewResponse,
} from './cycle-revision.dto.js';
import {
  type CycleChangeConfirmInput,
  type CycleChangePreviewInput,
  cycleChangeConfirmSchema,
  cycleChangePreviewSchema,
  uuidParamSchema,
} from './cycle-revision.schemas.js';

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

@ApiTags('cycle change (v2)')
@Controller({ path: 'budgets/:budgetId/cycle-change', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class CycleRevisionController {
  constructor(
    @Inject(CycleRevisionApplicationService)
    private readonly service: CycleRevisionApplicationService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Предпросмотр смены границ цикла без записи',
    description:
      'Только расчёт: ничего не пишет. Новые настройки вступают с начала первого полного цикла строго после подтверждённых периодов (effectiveOn); до него действуют прежние границы, возможный неполный период показан в transitionRanges. previewHash фиксирует состояние для confirm. Только OWNER. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|CSRF_INVALID, 404 бюджет, 409 MODEL_VERSION_MISMATCH|CYCLE_CHANGE_PENDING (предыдущая смена ещё не вступила в силу), 422 CYCLE_SETTINGS_UNCHANGED.',
  })
  @ApiBody({ type: CycleChangePreviewRequest })
  @ApiOkResponse({ type: CycleChangePreviewResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN: не OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH, CYCLE_CHANGE_PENDING.',
  })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  preview(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Body(new ZodValidationPipe(cycleChangePreviewSchema)) input: CycleChangePreviewInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.preview(contextOf(request).userId, budgetId, input);
  }

  @Post('confirm')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Подтвердить смену границ цикла',
    description:
      'Одна транзакция: блокировка бюджета, идемпотентность, пересчёт previewHash (расхождение даёт 409 PREVIEW_STALE без записи). При первой смене записывается baseline revision со старыми настройками на дату активации модели, затем revision с новыми настройками на effectiveOn; переходные интервалы создаются как строки периодов конвертов, цели задаёт владелец (null — без цели). Подтверждённые периоды, назначения, движения и даты операций не меняются; поля бюджета не меняются. Повтор с тем же ключом возвращает тот же ответ. Один audit. Только OWNER. Коды: 400 VALIDATION_FAILED (в т.ч. periodStart не из transitionRanges), 401, 403 FORBIDDEN|CSRF_INVALID, 404 бюджет, 409 PREVIEW_STALE|CYCLE_CHANGE_PENDING|IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 CYCLE_SETTINGS_UNCHANGED.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CycleChangeConfirmRequest })
  @ApiOkResponse({ type: CycleChangeConfirmResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN: не OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description:
      'PREVIEW_STALE, CYCLE_CHANGE_PENDING, IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.',
  })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async confirm(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Body(new ZodValidationPipe(cycleChangeConfirmSchema)) input: CycleChangeConfirmInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.service.confirm(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
}
