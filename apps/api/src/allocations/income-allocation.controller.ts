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
  Patch,
  Post,
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
import { IncomeAllocationApplicationService } from './income-allocation.application.service.js';
import {
  CreateIncomeAllocationRequest,
  IncomeAllocationResponse,
  UpdateIncomeAllocationRequest,
} from './income-allocation.dto.js';
import {
  createIncomeAllocationSchema,
  type CreateIncomeAllocationInput,
  type UpdateIncomeAllocationInput,
  updateIncomeAllocationSchema,
} from './income-allocation.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('income allocations')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class IncomeAllocationController {
  constructor(
    @Inject(IncomeAllocationApplicationService)
    private readonly service: IncomeAllocationApplicationService,
  ) {}

  @Get('budgets/:budgetId/transactions/:transactionId/allocations')
  @ApiOkResponse({ type: [IncomeAllocationResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Param('transactionId') transactionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listForIncome(contextOf(request).userId, budgetId, transactionId);
  }

  @Post('budgets/:budgetId/transactions/:transactionId/allocations')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: CreateIncomeAllocationRequest })
  @ApiCreatedResponse({ type: IncomeAllocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Param('transactionId') transactionId: string,
    @Body(new ZodValidationPipe(createIncomeAllocationSchema)) input: CreateIncomeAllocationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(
      contextOf(request).userId,
      budgetId,
      transactionId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Patch('budgets/:budgetId/allocations/:allocationId')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: UpdateIncomeAllocationRequest })
  @ApiOkResponse({ type: IncomeAllocationResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('allocationId') allocationId: string,
    @Body(new ZodValidationPipe(updateIncomeAllocationSchema)) input: UpdateIncomeAllocationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(
      contextOf(request).userId,
      budgetId,
      allocationId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Post('budgets/:budgetId/allocations/:allocationId/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: IncomeAllocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  restore(
    @Param('budgetId') budgetId: string,
    @Param('allocationId') allocationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.restore(
      contextOf(request).userId,
      budgetId,
      allocationId,
      validKey(key),
      request.id,
    );
  }

  @Delete('budgets/:budgetId/allocations/:allocationId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: IncomeAllocationResponse })
  delete(
    @Param('budgetId') budgetId: string,
    @Param('allocationId') allocationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.delete(
      contextOf(request).userId,
      budgetId,
      allocationId,
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
    });
  }
  return key;
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
