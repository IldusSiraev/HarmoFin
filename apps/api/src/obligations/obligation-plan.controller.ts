import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ObligationPlanApplicationService } from './obligation-plan.application.service.js';
import {
  ObligationOccurrenceListResponse,
  ObligationOneTimePayBody,
  ObligationOneTimePayResponse,
  ObligationPlanCreateBody,
  ObligationPlanCreateResponse,
  ObligationPlanListResponse,
  ObligationPlanUpdateBody,
  ObligationPlanUpdateResponse,
} from './obligation-plan.dto.js';
import {
  createObligationPlanSchema,
  listObligationOccurrencesSchema,
  listObligationPlansSchema,
  oneTimePaySchema,
  updateObligationPlanSchema,
  uuidParamSchema,
  type CreateObligationPlanInput,
  type ListObligationOccurrencesInput,
  type ListObligationPlansInput,
  type OneTimePayInput,
  type UpdateObligationPlanInput,
} from './obligation-plan.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

const conflictCodes =
  'Коды 409: MANDATORY_ENVELOPE_REQUIRED (нет активного конверта обязательных расходов), IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.';

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
@Controller({ path: 'budgets/:budgetId/obligations', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ObligationPlanController {
  constructor(
    @Inject(ObligationPlanApplicationService)
    private readonly service: ObligationPlanApplicationService,
  ) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Список обязательных планов',
    description:
      'Планы расходов на конверте обязательных расходов. Доступно любому участнику; в ответе owner и canEdit.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({
    name: 'ownerUserId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Только планы с этим владельцем.',
  })
  @ApiOkResponse({ type: ObligationPlanListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  listPlans(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(listObligationPlansSchema)) query: ListObligationPlansInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listPlans(contextOf(request).userId, budgetId, query);
  }

  @Post('plans')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Создать обязательный план (разовый или регулярный)',
    description: `Создаёт план расхода на активном конверте обязательных расходов и сразу материализует occurrences текущего и следующего периода без worker. Для ONE_TIME возвращает occurrenceId для оплаты. OWNER или EDITOR; план принадлежит создателю. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: ObligationPlanCreateBody })
  @ApiCreatedResponse({ type: ObligationPlanCreateResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  createPlan(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(createObligationPlanSchema)) input: CreateObligationPlanInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createPlan(
      contextOf(request).userId,
      budgetId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Post('one-time-pay')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Разовый обязательный платёж и расход одним действием',
    description: `Атомарно создаёт ONE_TIME план на конверте обязательных расходов, occurrence (ожидаемая сумма = plannedAmount), подтверждённый расход v2 на actualAmount и оплату; occurrence становится COMPLETED. Плановая и фактическая суммы могут различаться. Будущая дата оплаты отклоняется. При ошибке откатывается всё. OWNER или EDITOR. Коды 409: MANDATORY_ENVELOPE_REQUIRED, INSUFFICIENT_BALANCE, IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: ObligationOneTimePayBody })
  @ApiCreatedResponse({ type: ObligationOneTimePayResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  payOneTime(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(oneTimePaySchema)) input: OneTimePayInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.payOneTime(
      contextOf(request).userId,
      budgetId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Patch('plans/:planId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Изменить или архивировать обязательный план',
    description: `Имя и сумма применяются к будущим неоплаченным occurrences; уже наступившие открытые меняются только при applyToCurrentOpen=true; оплаченные, завершённые и пропущенные не меняются. status=ARCHIVED отключает только будущие неоплаченные. OWNER или EDITOR-владелец плана; чужой план — 403. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: ObligationPlanUpdateBody })
  @ApiOkResponse({ type: ObligationPlanUpdateResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN или NOT_OBJECT_OWNER.',
  })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  updatePlan(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('planId', idPipe) planId: string,
    @Body(new ZodValidationPipe(updateObligationPlanSchema)) input: UpdateObligationPlanInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updatePlan(
      contextOf(request).userId,
      budgetId,
      planId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Get('occurrences')
  @ApiOperation({
    summary: 'Список обязательств (occurrences обязательных планов)',
    description: 'Ожидаемая, оплаченная и неоплаченная суммы в minor-строках.',
  })
  @ApiQuery({ name: 'planId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'],
  })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiOkResponse({ type: ObligationOccurrenceListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  listOccurrences(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(listObligationOccurrencesSchema))
    query: ListObligationOccurrencesInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listOccurrences(contextOf(request).userId, budgetId, query);
  }
}
