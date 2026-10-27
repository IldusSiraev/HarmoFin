import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  Inject,
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
import { ObligationPayBody, ObligationResultResponse } from './obligation.dto.js';
import { ObligationApplicationService } from './obligation.application.service.js';
import {
  obligationPaySchema,
  uuidParamSchema,
  type ObligationPayBodyInput,
} from './obligation.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

const conflictCodes =
  'Коды 409: OCCURRENCE_NOT_OPEN (обязательство уже закрыто, пропущено или отменено), OCCURRENCE_NOT_PAYABLE (нет активного плана расхода с обязательным конвертом), OCCURRENCE_HAS_PAYMENTS (skip при наличии оплат), OCCURRENCE_HAS_NO_PAYMENTS (close без оплат), INSUFFICIENT_BALANCE (недостаточно средств на счёте), IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.';

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

@ApiTags('obligations (v2)')
@Controller({ path: 'budgets/:budgetId/obligations/:occurrenceId', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ObligationController {
  constructor(
    @Inject(ObligationApplicationService) private readonly service: ObligationApplicationService,
  ) {}

  @Post('pay')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Оплатить обязательство',
    description: `Создаёт подтверждённый расход по фактической сумме; ожидаемая сумма плана не меняется. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: ObligationPayBody })
  @ApiOkResponse({ type: ObligationResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN, NOT_OBJECT_OWNER или NOT_ACCOUNT_OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async pay(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('occurrenceId', idPipe) occurrenceId: string,
    @Body(new ZodValidationPipe(obligationPaySchema)) input: ObligationPayBodyInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.pay(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      {
        accountId: input.accountId,
        categoryId: input.categoryId,
        amount: input.amount,
        occurredOn: input.occurredOn,
        willPayMore: input.willPayMore,
      },
      validKey(key),
      request.id,
    );
  }

  @Post('skip')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Пропустить обязательство без оплат',
    description: `Переводит открытое обязательство без оплат в SKIPPED; расход не создаётся. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: ObligationResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN или NOT_OBJECT_OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async skip(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('occurrenceId', idPipe) occurrenceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.skip(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      validKey(key),
      request.id,
    );
  }

  @Post('close')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Закрыть обязательство после частичных оплат',
    description: `Переводит открытое обязательство хотя бы с одной оплатой в COMPLETED; расход не создаётся. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: ObligationResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN или NOT_OBJECT_OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async close(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('occurrenceId', idPipe) occurrenceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.close(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      validKey(key),
      request.id,
    );
  }
}
