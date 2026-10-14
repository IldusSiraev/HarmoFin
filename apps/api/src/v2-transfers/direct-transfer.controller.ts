import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  directTransferSchema,
  directTransferListSchema,
  transferIdParamSchema,
  type CreateDirectTransferInput,
  type DirectTransferListQuery,
} from './direct-transfer.schemas.js';
import {
  CreateDirectTransferInput as CreateDirectTransferInputDto,
  DirectTransferListResponse,
  DirectTransferResponse,
} from './direct-transfer.dto.js';
import {
  DirectTransferApplicationService,
  type DirectTransferInput,
} from './direct-transfer.application.service.js';

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

@ApiTags('direct transfers (v2)')
@Controller({ path: 'budgets/:budgetId/transfers', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class DirectTransferController {
  constructor(
    @Inject(DirectTransferApplicationService)
    private readonly service: DirectTransferApplicationService,
  ) {}

  @Get()
  @ApiOkResponse({ type: DirectTransferListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(directTransferListSchema)) query: DirectTransferListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Get(':transferId')
  @ApiOkResponse({ type: DirectTransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async get(
    @Param('budgetId') budgetId: string,
    @Param('transferId', new ZodValidationPipe(transferIdParamSchema)) transferId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, transferId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CreateDirectTransferInputDto })
  @ApiCreatedResponse({ type: DirectTransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(directTransferSchema)) input: CreateDirectTransferInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const serviceInput: DirectTransferInput = {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amount: input.amount,
      occurredOn: input.occurredOn,
    };
    if (input.comment !== undefined) {
      serviceInput.comment = input.comment;
    }

    return this.service.create(
      contextOf(request).userId,
      budgetId,
      serviceInput,
      validKey(key),
      request.id,
    );
  }
}
