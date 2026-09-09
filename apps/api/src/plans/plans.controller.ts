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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TransactionResponse } from '../transactions/transaction.dto.js';
import { RegularPlanApplicationService } from './regular-plan.application.service.js';
import {
  CreateRegularPlanRequest,
  PlanOccurrenceListResponse,
  PlanOccurrenceResponse,
  RegularPlanListResponse,
  RegularPlanResponse,
  UpdateRegularPlanRequest,
} from './plans.dto.js';
import {
  createRegularPlanSchema,
  type CreateRegularPlanInput,
  type ListPlanOccurrencesInput,
  type ListRegularPlansInput,
  listPlanOccurrencesSchema,
  listRegularPlansSchema,
  type UpdateRegularPlanInput,
  updateRegularPlanSchema,
} from './plans.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('plans')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class PlansController {
  constructor(
    @Inject(RegularPlanApplicationService) private readonly service: RegularPlanApplicationService,
  ) {}

  @Get('budgets/:budgetId/plans')
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiOkResponse({ type: RegularPlanListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listRegularPlansSchema)) query: ListRegularPlansInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('budgets/:budgetId/plans')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: CreateRegularPlanRequest })
  @ApiCreatedResponse({ type: RegularPlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createRegularPlanSchema)) input: CreateRegularPlanInput,
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

  @Get('budgets/:budgetId/plans/occurrences')
  @ApiQuery({ name: 'planId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'],
  })
  @ApiQuery({ name: 'from', required: false, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: false, schema: { type: 'string', format: 'date' } })
  @ApiOkResponse({ type: PlanOccurrenceListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  listOccurrences(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listPlanOccurrencesSchema)) query: ListPlanOccurrencesInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listOccurrences(contextOf(request).userId, budgetId, query);
  }

  @Post('budgets/:budgetId/plans/occurrences/:occurrenceId/skip')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: PlanOccurrenceResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  skipOccurrence(
    @Param('budgetId') budgetId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.skipOccurrence(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      validKey(key),
      request.id,
    );
  }

  @Post('budgets/:budgetId/plans/occurrences/:occurrenceId/complete')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: PlanOccurrenceResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  completeOccurrence(
    @Param('budgetId') budgetId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.completeOccurrence(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      validKey(key),
      request.id,
    );
  }

  @Post('budgets/:budgetId/plans/occurrences/:occurrenceId/create-draft')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiCreatedResponse({ type: TransactionResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  createOccurrenceDraft(
    @Param('budgetId') budgetId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createDraftFromOccurrence(
      contextOf(request).userId,
      budgetId,
      occurrenceId,
      validKey(key),
      request.id,
    );
  }

  @Get('budgets/:budgetId/plans/:planId')
  @ApiOkResponse({ type: RegularPlanResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('planId') planId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, planId);
  }

  @Patch('budgets/:budgetId/plans/:planId')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: UpdateRegularPlanRequest })
  @ApiOkResponse({ type: RegularPlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('planId') planId: string,
    @Body(new ZodValidationPipe(updateRegularPlanSchema)) input: UpdateRegularPlanInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(
      contextOf(request).userId,
      budgetId,
      planId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Delete('budgets/:budgetId/plans/:planId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: RegularPlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  remove(
    @Param('budgetId') budgetId: string,
    @Param('planId') planId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remove(
      contextOf(request).userId,
      budgetId,
      planId,
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
