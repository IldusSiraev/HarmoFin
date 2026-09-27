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
import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import {
  CreateEnvelopeReallocationRequest,
  EnvelopeReallocationListResponse,
  EnvelopeReallocationResponse,
} from './envelope-reallocation.dto.js';
import {
  createEnvelopeReallocationSchema,
  type CreateEnvelopeReallocationInput,
  type ListEnvelopeReallocationsInput,
  listEnvelopeReallocationsSchema,
} from './envelope-reallocation.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('envelope-reallocations')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class EnvelopeReallocationController {
  constructor(
    @Inject(EnvelopeReallocationApplicationService)
    private readonly service: EnvelopeReallocationApplicationService,
  ) {}

  @Get('budgets/:budgetId/envelope-reallocations')
  @ApiOkResponse({ type: EnvelopeReallocationListResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listEnvelopeReallocationsSchema))
    query: ListEnvelopeReallocationsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('budgets/:budgetId/envelope-reallocations')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: CreateEnvelopeReallocationRequest })
  @ApiCreatedResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createEnvelopeReallocationSchema))
    input: CreateEnvelopeReallocationInput,
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

  @Get('budgets/:budgetId/envelope-reallocations/:id')
  @ApiOkResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, id);
  }

  @Delete('budgets/:budgetId/envelope-reallocations/:id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  delete(
    @Param('budgetId') budgetId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.delete(
      contextOf(request).userId,
      budgetId,
      id,
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
