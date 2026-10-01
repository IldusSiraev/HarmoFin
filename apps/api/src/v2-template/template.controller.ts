import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TemplateApplyApplicationService } from './template-apply.application.service.js';
import { TemplatePreviewApplicationService } from './template-preview.application.service.js';
import {
  TemplateApplyRequest,
  TemplateApplyResponse,
  TemplatePreviewResponse,
} from './template.dto.js';
import {
  templateApplySchema,
  uuidParamSchema,
  type TemplateApplyInput,
} from './template.schemas.js';

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

@ApiTags('reference template (v2)')
@Controller({ path: 'budgets/:budgetId/reference-template', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class TemplateController {
  constructor(
    @Inject(TemplatePreviewApplicationService)
    private readonly preview: TemplatePreviewApplicationService,
    @Inject(TemplateApplyApplicationService)
    private readonly applyTemplate: TemplateApplyApplicationService,
  ) {}

  @Get('preview')
  @ApiOperation({
    summary: 'Предпросмотр базового шаблона v2 без записи',
    description:
      'Только чтение: ничего не создаёт, не пишет audit и не берёт блокировку. Показывает существующие, отсутствующие, архивные и конфликтующие категории и конверты (первый и второй период, обязательные, накопления по выбору; FREE_MONEY не предлагается), настроенные cycleStartDay/periodBoundaryOffset, необязательные цели периода и previewHash текущих элементов и настроек. Сопоставление: сначала templateKey, затем совместимые имя, тип и роль периода; переименованный ключевой элемент не меняется. Архивный ключевой элемент: ARCHIVED, замена только CREATE с согласием. Одинаковое имя с несовместимым типом: COLLISION. Только OWNER (предпросмотр управляет apply). Коды: 400 некорректный budgetId, 401, 403 не OWNER, 404 бюджет, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiOkResponse({ type: TemplatePreviewResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN: не OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'MODEL_VERSION_MISMATCH: бюджет не на модели v2.',
  })
  getPreview(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.preview.preview(contextOf(request).userId, budgetId);
  }

  @Post('apply')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Применить настроенный шаблон v2 без дублей',
    description:
      'Одна транзакция: блокировка бюджета, идемпотентность, пересчёт previewHash (расхождение даёт 409 PREVIEW_STALE без записи). Использует совместимые существующие строки, создаёт только недостающие с неконфликтующими ключами и нулевым legacy-стартом; правило и приоритет задаются только новым конвертам и принятым без правила, существующие правило, приоритет, цель и имя не меняются. Не создаёт счета, доходы, расходы, назначения и FREE_MONEY. Конфликт с SKIP не создаёт дубль и оставляет шаг незавершённым (isComplete=false). Повтор с тем же ключом возвращает тот же ответ; другой ключ после нового preview добавляет только недостающее. Смена цикла только без подтверждённых фактов, назначений и целей: UNSET/DRAFT периоды перестраиваются, иначе 409. Один audit без финансовых сумм. Только OWNER. Коды: 400 VALIDATION_FAILED, 403 FORBIDDEN|CSRF_INVALID, 404 бюджет, 409 PREVIEW_STALE|CYCLE_CHANGE_REQUIRES_FLOW|IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 TEMPLATE_ADOPT_UNAVAILABLE|TEMPLATE_ELEMENT_EXISTS|TEMPLATE_NAME_REQUIRED|TEMPLATE_NAME_CONFLICT|TEMPLATE_SAVINGS_UNKNOWN.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: TemplateApplyRequest })
  @ApiOkResponse({ type: TemplateApplyResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN: не OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description:
      'PREVIEW_STALE, CYCLE_CHANGE_REQUIRES_FLOW, IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.',
  })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async apply(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Body(new ZodValidationPipe(templateApplySchema)) input: TemplateApplyInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.applyTemplate.apply(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
}
