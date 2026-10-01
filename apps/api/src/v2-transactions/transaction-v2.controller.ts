import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  createTransactionV2Schema,
  type CreateTransactionV2Input,
} from './transaction-v2.schemas.js';
import { CreateTransactionV2Body, TransactionV2Response } from './transaction-v2.dto.js';
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
}
