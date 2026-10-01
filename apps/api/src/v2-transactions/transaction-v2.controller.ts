import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  budgetIdParamSchema,
  createTransactionV2Schema,
  listTransactionsV2Schema,
  transactionIdParamSchema,
  type CreateTransactionV2Input,
  type ListTransactionsV2Input,
  type UpdateTransactionV2Input,
  updateTransactionV2Schema,
} from './transaction-v2.schemas.js';
import {
  CreateTransactionV2Body,
  TransactionJournalV2Item,
  TransactionJournalV2Response,
  TransactionV2LifecycleResponse,
  TransactionV2Response,
  UpdateTransactionV2Body,
} from './transaction-v2.dto.js';
import { TransactionV2ApplicationService } from './transaction-v2.application.service.js';

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

@ApiTags('transactions (v2)')
@Controller({ path: 'budgets/:budgetId/transactions', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class TransactionV2Controller {
  constructor(private readonly service: TransactionV2ApplicationService) {}

  @Get()
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', maxLength: 512 } })
  @ApiQuery({ name: 'type', required: false, enum: ['INCOME', 'EXPENSE'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED'],
    description: 'DELETED доступен только владельцу (иначе 403); по умолчанию удалённые скрыты.',
  })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'accountId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'categoryId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'envelopeId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: TransactionJournalV2Response })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Query(new ZodValidationPipe(listTransactionsV2Schema)) query: ListTransactionsV2Input,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Get(':transactionId')
  @ApiOkResponse({ type: TransactionJournalV2Item })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, transactionId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CreateTransactionV2Body })
  @ApiCreatedResponse({ type: TransactionV2Response })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createTransactionV2Schema)) input: CreateTransactionV2Input,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(
      contextOf(request).userId,
      budgetId,
      {
        transactionType: input.transactionType,
        status: input.status,
        amount: input.amount,
        occurredOn: input.occurredOn,
        accountId: input.accountId,
        categoryId: input.categoryId,
        envelopeId: input.envelopeId ?? null,
        comment: input.comment ?? null,
      },
      validKey(key),
      request.id,
    );
  }

  @Patch(':transactionId')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: UpdateTransactionV2Body })
  @ApiOkResponse({ type: TransactionV2LifecycleResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Body(new ZodValidationPipe(updateTransactionV2Schema)) input: UpdateTransactionV2Input,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(
      contextOf(request).userId,
      budgetId,
      transactionId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Delete(':transactionId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: TransactionV2LifecycleResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  remove(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remove(
      contextOf(request).userId,
      budgetId,
      transactionId,
      validKey(key),
      request.id,
    );
  }

  @Post(':transactionId/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: TransactionV2LifecycleResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  restore(
    @Param('budgetId', new ZodValidationPipe(budgetIdParamSchema)) budgetId: string,
    @Param('transactionId', new ZodValidationPipe(transactionIdParamSchema))
    transactionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.restore(
      contextOf(request).userId,
      budgetId,
      transactionId,
      validKey(key),
      request.id,
    );
  }
}
