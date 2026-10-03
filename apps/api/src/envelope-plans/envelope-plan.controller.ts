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
  Put,
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
import { AssignmentApplicationService } from './assignment.application.service.js';
import {
  reviseAssignmentSchema,
  type CreateEnvelopeAssignmentInput,
  type CreateIncomeAssignmentInput,
  type ReviseAssignmentInput,
} from './assignment.schemas.js';
import {
  CreateAssignmentRequest,
  CreateEnvelopeRequest,
  EnvelopeHistoryListResponse,
  EnvelopePlanListResponse,
  AssignmentResultResponse,
  EnvelopePlanResponse,
  MovementResultResponse,
  FundingRuleResponse,
  MoveEnvelopeRequest,
  PeriodTargetResponse,
  PutFundingRuleRequest,
  PutPeriodTargetRequest,
  ReviseAssignmentRequest,
  UpdateEnvelopeRequest,
} from './envelope-plan.dto.js';
import { EnvelopePlanApplicationService } from './envelope-plan.application.service.js';
import {
  createAssignmentSchema,
  createEnvelopeSchema,
  envelopeHistorySchema,
  putFundingRuleSchema,
  putPeriodTargetSchema,
  updateEnvelopeSchema,
  uuidParamSchema,
  type CreateAssignmentInput,
  type CreateEnvelopeInput,
  type EnvelopeHistoryQuery,
  type PutFundingRuleInput,
  type PutPeriodTargetInput,
  type UpdateEnvelopeInput,
} from './envelope-plan.schemas.js';
import { MovementApplicationService } from './movement.application.service.js';
import { PeriodTargetApplicationService } from './period-target.application.service.js';
import { moveEnvelopeSchema, type MoveEnvelopeInput } from './movement.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

@ApiTags('envelope-plans (v2)')
@Controller({ path: 'budgets/:budgetId', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class EnvelopePlanController {
  constructor(
    @Inject(EnvelopePlanApplicationService)
    private readonly plans: EnvelopePlanApplicationService,
    @Inject(AssignmentApplicationService)
    private readonly assignments: AssignmentApplicationService,
    @Inject(MovementApplicationService)
    private readonly movements: MovementApplicationService,
    @Inject(PeriodTargetApplicationService)
    private readonly periodTargets: PeriodTargetApplicationService,
  ) {}

  @Get('envelopes')
  @ApiOkResponse({ type: EnvelopePlanListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async list(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return (await this.plans.list(contextOf(request).userId, budgetId)).body;
  }

  @Post('envelopes')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CreateEnvelopeRequest })
  @ApiCreatedResponse({ type: EnvelopePlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createEnvelopeSchema)) input: CreateEnvelopeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.plans.create(contextOf(request).userId, budgetId, input, validKey(key), request.id)
    ).body;
  }

  @Get('envelopes/:envelopeId')
  @ApiOkResponse({ type: EnvelopePlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async get(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return (await this.plans.get(contextOf(request).userId, budgetId, envelopeId)).body;
  }

  @Patch('envelopes/:envelopeId')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: UpdateEnvelopeRequest })
  @ApiOkResponse({ type: EnvelopePlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async update(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Body(new ZodValidationPipe(updateEnvelopeSchema)) input: UpdateEnvelopeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.plans.update(
        contextOf(request).userId,
        budgetId,
        envelopeId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Post('envelopes/:envelopeId/archive')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: EnvelopePlanResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async archive(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.plans.archive(
        contextOf(request).userId,
        budgetId,
        envelopeId,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Get('envelopes/:envelopeId/history')
  @ApiOkResponse({ type: EnvelopeHistoryListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async history(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Query(new ZodValidationPipe(envelopeHistorySchema)) query: EnvelopeHistoryQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return (await this.plans.history(contextOf(request).userId, budgetId, envelopeId, query)).body;
  }

  @Put('envelopes/:envelopeId/funding-rule')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: PutFundingRuleRequest })
  @ApiOkResponse({ type: FundingRuleResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async putFundingRule(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId', new ZodValidationPipe(uuidParamSchema)) envelopeId: string,
    @Body(new ZodValidationPipe(putFundingRuleSchema)) input: PutFundingRuleInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.periodTargets.putFundingRule(
        contextOf(request).userId,
        budgetId,
        envelopeId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Put('envelopes/:envelopeId/periods/:periodStart/target')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: PutPeriodTargetRequest })
  @ApiOkResponse({ type: PeriodTargetResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async putPeriodTarget(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId', new ZodValidationPipe(uuidParamSchema)) envelopeId: string,
    @Param('periodStart') periodStart: string,
    @Body(new ZodValidationPipe(putPeriodTargetSchema)) input: PutPeriodTargetInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.periodTargets.putPeriodTarget(
        contextOf(request).userId,
        budgetId,
        envelopeId,
        periodStart,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Post('periods/:periodId/confirm-target')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: PeriodTargetResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async confirmTarget(
    @Param('budgetId') budgetId: string,
    @Param('periodId', new ZodValidationPipe(uuidParamSchema)) periodId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.periodTargets.confirmTarget(
        contextOf(request).userId,
        budgetId,
        periodId,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Post('periods/:periodId/reject-target')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: PeriodTargetResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async rejectTarget(
    @Param('budgetId') budgetId: string,
    @Param('periodId', new ZodValidationPipe(uuidParamSchema)) periodId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.periodTargets.rejectTarget(
        contextOf(request).userId,
        budgetId,
        periodId,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Post('assignments')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CreateAssignmentRequest })
  @ApiCreatedResponse({ type: AssignmentResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async createAssignment(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createAssignmentSchema)) input: CreateAssignmentInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = contextOf(request).userId;
    const operation = validKey(key);
    if (input.sourceKind === 'FREE') {
      return (
        await this.assignments.assignFree(
          userId,
          budgetId,
          toFreeInput(input),
          operation,
          request.id,
        )
      ).body;
    }
    if (input.incomeTransactionId !== undefined) {
      return (
        await this.assignments.assignIncome(
          userId,
          budgetId,
          toIncomeInput(input),
          operation,
          request.id,
        )
      ).body;
    }
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Для sourceKind=INCOME обязательно поле incomeTransactionId.',
    });
  }

  @Patch('assignments/:assignmentId')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: ReviseAssignmentRequest })
  @ApiOkResponse({ type: AssignmentResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async reviseAssignment(
    @Param('budgetId') budgetId: string,
    @Param('assignmentId') assignmentId: string,
    @Body(new ZodValidationPipe(reviseAssignmentSchema)) input: ReviseAssignmentInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.assignments.reviseAssignment(
        contextOf(request).userId,
        budgetId,
        assignmentId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Delete('assignments/:assignmentId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiOkResponse({ type: AssignmentResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async cancelAssignment(
    @Param('budgetId') budgetId: string,
    @Param('assignmentId') assignmentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.assignments.cancelAssignment(
        contextOf(request).userId,
        budgetId,
        assignmentId,
        validKey(key),
        request.id,
      )
    ).body;
  }

  @Post('movements')
  @UseGuards(CsrfGuard)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: MoveEnvelopeRequest })
  @ApiCreatedResponse({ type: MovementResultResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async move(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(moveEnvelopeSchema)) input: MoveEnvelopeInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.movements.move(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
}

type CreateUnifiedAssignmentInput = {
  envelopeId: string;
  incomeTransactionId?: string | undefined;
  periodId?: string | undefined;
  amount: string;
  sourceKind: 'FREE' | 'INCOME';
};

function toFreeInput(input: CreateUnifiedAssignmentInput): CreateEnvelopeAssignmentInput {
  return {
    envelopeId: input.envelopeId,
    ...(input.periodId !== undefined ? { periodId: input.periodId } : {}),
    amount: input.amount,
    sourceKind: 'FREE',
  };
}

function toIncomeInput(input: CreateUnifiedAssignmentInput): CreateIncomeAssignmentInput {
  return {
    incomeTransactionId: input.incomeTransactionId!,
    envelopeId: input.envelopeId,
    ...(input.periodId !== undefined ? { periodId: input.periodId } : {}),
    amount: input.amount,
  };
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
