import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TransferApplicationService } from './transfer.application.service.js';
import { CreateTransferRequest, TransferListResponse, TransferResponse } from './transfer.dto.js';
import {
  createTransferSchema,
  type CreateTransferInput,
  type ListTransfersInput,
  listTransfersSchema,
} from './transfer.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('transfers')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class TransferController {
  constructor(
    @Inject(TransferApplicationService) private readonly service: TransferApplicationService,
  ) {}

  @Get('budgets/:budgetId/transfers')
  @ApiOkResponse({ type: TransferListResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listTransfersSchema)) query: ListTransfersInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('budgets/:budgetId/transfers')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: CreateTransferRequest })
  @ApiCreatedResponse({ type: TransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createTransferSchema)) input: CreateTransferInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(
      contextOf(request).userId,
      budgetId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Get('budgets/:budgetId/transfers/:transferId')
  @ApiOkResponse({ type: TransferResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('transferId') transferId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, transferId);
  }

  @Post('budgets/:budgetId/transfers/:transferId/confirm')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: TransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  confirm(
    @Param('budgetId') budgetId: string,
    @Param('transferId') transferId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.confirm(
      contextOf(request).userId,
      budgetId,
      transferId,
      validKey(key),
      request.id,
    );
  }

  @Post('budgets/:budgetId/transfers/:transferId/cancel')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: TransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  cancel(
    @Param('budgetId') budgetId: string,
    @Param('transferId') transferId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.cancel(
      contextOf(request).userId,
      budgetId,
      transferId,
      validKey(key),
      request.id,
    );
  }

  @Delete('budgets/:budgetId/transfers/:transferId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: TransferResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  delete(
    @Param('budgetId') budgetId: string,
    @Param('transferId') transferId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.delete(
      contextOf(request).userId,
      budgetId,
      transferId,
      validKey(key),
      request.id,
    );
  }
}

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
