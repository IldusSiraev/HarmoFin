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
import { IncomePlanApplicationService } from './income-plan-v2.application.service.js';
import {
  IncomeOccurrenceListResponse,
  IncomePlanCreateBody,
  IncomePlanCreateResponse,
  IncomePlanListResponse,
  IncomePlanUpdateBody,
  IncomePlanUpdateResponse,
  IncomeRecordBody,
  IncomeRecordResponse,
} from './income-plan-v2.dto.js';
import {
  createIncomePlanSchema,
  incomeUuidParamSchema,
  listIncomeOccurrencesSchema,
  listIncomePlansSchema,
  recordIncomeSchema,
  updateIncomePlanSchema,
  type CreateIncomePlanInput,
  type ListIncomeOccurrencesInput,
  type ListIncomePlansInput,
  type RecordIncomeInput,
  type UpdateIncomePlanInput,
} from './income-plan-v2.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

const conflictCodes = 'Коды 409: IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.';

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

const idPipe = new ZodValidationPipe(incomeUuidParamSchema);

@ApiTags('income plans (v2)')
@Controller({ path: 'budgets/:budgetId/income-plans', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class IncomePlanController {
  constructor(
    @Inject(IncomePlanApplicationService) private readonly service: IncomePlanApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список планов доходов',
    description:
      'Прогнозы доходов (RegularPlan INCOME). Прогноз не является деньгами. Доступно любому участнику.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({
    name: 'ownerUserId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Только планы с этим владельцем.',
  })
  @ApiOkResponse({ type: IncomePlanListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  listPlans(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(listIncomePlansSchema)) query: ListIncomePlansInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listPlans(contextOf(request).userId, budgetId, query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Создать план дохода (разовый или регулярный)',
    description: `Создаёт прогноз дохода на активной категории дохода и материализует occurrences текущего и следующего периода без worker. Не создаёт операций и назначений, не входит в деньги и обязательные платежи. Создание — любой участник с правом записи; управление — только владелец плана. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: IncomePlanCreateBody })
  @ApiCreatedResponse({ type: IncomePlanCreateResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  createPlan(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(createIncomePlanSchema)) input: CreateIncomePlanInput,
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

  @Get('occurrences')
  @ApiOperation({
    summary: 'Список прогнозов доходов (occurrences)',
    description:
      'Будущие и прошлые occurrences планов доходов; expectedMinor — прогноз, transactionId — связанный фактический доход.',
  })
  @ApiQuery({ name: 'planId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'],
  })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiOkResponse({ type: IncomeOccurrenceListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  listOccurrences(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(listIncomeOccurrencesSchema)) query: ListIncomeOccurrencesInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listOccurrences(contextOf(request).userId, budgetId, query);
  }

  @Post('occurrences/:occurrenceId/record')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Записать фактический доход по прогнозу',
    description: `Атомарно создаёт одну подтверждённую операцию INCOME (v2) и закрывает occurrence (COMPLETED, transactionId). Категория по умолчанию — категория плана. Будущая дата отклоняется. Назначение дохода конвертам остаётся отдельным явным действием. Запись — только владелец плана; создание плана доступно любому участнику с правом записи (OWNER, EDITOR). Коды 409: OCCURRENCE_NOT_OPEN (повторная запись, даже с другим Idempotency-Key, либо план отключён), IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: IncomeRecordBody })
  @ApiCreatedResponse({ type: IncomeRecordResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN или NOT_OBJECT_OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  recordIncome(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('occurrenceId', idPipe) occurrenceId: string,
    @Body(new ZodValidationPipe(recordIncomeSchema)) input: RecordIncomeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.recordIncome(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Patch(':planId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Изменить или архивировать план дохода',
    description: `Имя и сумма применяются к будущим открытым occurrences; уже наступившие открытые меняются только при applyToCurrentOpen=true; закрытые не меняются. status=ARCHIVED отключает только будущие открытые. Управление — только владелец плана. ${conflictCodes}`,
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: IncomePlanUpdateBody })
  @ApiOkResponse({ type: IncomePlanUpdateResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN или NOT_OBJECT_OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  updatePlan(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('planId', idPipe) planId: string,
    @Body(new ZodValidationPipe(updateIncomePlanSchema)) input: UpdateIncomePlanInput,
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
}
