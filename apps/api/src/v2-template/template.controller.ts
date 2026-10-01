import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TemplatePreviewApplicationService } from './template-preview.application.service.js';
import { TemplatePreviewResponse } from './template.dto.js';
import { uuidParamSchema } from './template.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

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
}
