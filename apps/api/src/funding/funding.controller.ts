import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
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
import { FundingPreviewApplicationService } from './funding-preview.application.service.js';
import {
  FundingPreviewRequest,
  FundingPreviewResponse,
  IncomeCategorySuggestionRequest,
  IncomeCategorySuggestionResponse,
} from './funding.dto.js';
import {
  fundingPreviewSchema,
  putIncomeCategorySuggestionSchema,
  uuidParamSchema,
  type FundingPreviewRequestInput,
  type PutIncomeCategorySuggestionRequestInput,
} from './funding.schemas.js';
import { IncomeCategorySuggestionApplicationService } from './income-category-suggestion.application.service.js';

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

const idPipe = new ZodValidationPipe(uuidParamSchema);

@ApiTags('funding (v2)')
@Controller({ path: 'budgets/:budgetId', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class FundingController {
  constructor(
    @Inject(FundingPreviewApplicationService)
    private readonly preview: FundingPreviewApplicationService,
    @Inject(IncomeCategorySuggestionApplicationService)
    private readonly suggestion: IncomeCategorySuggestionApplicationService,
  ) {}

  @Post('funding/preview')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Предпросмотр назначений из источника без записи денег',
    description:
      'Сервер предлагает назначения INCOME/OPENING/FREE по правилам, потребности обязательных и целям текущего периода. Ничего не назначает и не подтверждает цели; допустима только идемпотентная запись структурной строки периода (DRAFT/UNSET). POST берёт блокировку бюджета, ключ идемпотентности не нужен. Только OWNER (как будущее подтверждение). Коды: 404 (бюджет/доход/конверт/период), 409 MODEL_VERSION_MISMATCH, 422 OPENING_NOT_AVAILABLE|ENVELOPE_ARCHIVED|PERIOD_REQUIRED|PERIOD_NOT_ALLOWED.',
  })
  @ApiBody({ type: FundingPreviewRequest })
  @ApiOkResponse({ type: FundingPreviewResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  previewFunding(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(fundingPreviewSchema)) input: FundingPreviewRequestInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.preview.preview(contextOf(request).userId, budgetId, input, request.id);
  }

  @Put('income-category-suggestion')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Сохранить правило предложения «категория дохода → конверт»',
    description:
      'Только настройка: назначения не создаются. Предложение 100% дохода этой категории показывает preview. Только OWNER; повтор с тем же Idempotency-Key возвращает тот же ответ без второго audit.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: IncomeCategorySuggestionRequest })
  @ApiOkResponse({ type: IncomeCategorySuggestionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async putIncomeCategorySuggestion(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(putIncomeCategorySuggestionSchema))
    input: PutIncomeCategorySuggestionRequestInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.suggestion.put(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
}
