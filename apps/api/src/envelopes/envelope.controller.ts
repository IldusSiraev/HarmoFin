import {
  Body,
  Controller,
  Get,
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
import { EnvelopeApplicationService } from './envelope.application.service.js';
import {
  CreateEnvelopeRequest,
  EnvelopeResponse,
  EnvelopeSummaryResponse,
  UpdateEnvelopeRequest,
} from './envelope.dto.js';
import {
  createEnvelopeSchema,
  type CreateEnvelopeInput,
  type EnvelopeSummaryInput,
  envelopeSummarySchema,
  type ListEnvelopesInput,
  listEnvelopesSchema,
  type UpdateEnvelopeInput,
  updateEnvelopeSchema,
} from './envelope.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('envelopes')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class EnvelopeController {
  constructor(
    @Inject(EnvelopeApplicationService) private readonly service: EnvelopeApplicationService,
  ) {}

  @Get('budgets/:budgetId/envelopes')
  @ApiOkResponse({ type: [EnvelopeResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listEnvelopesSchema)) query: ListEnvelopesInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query.status);
  }

  @Post('budgets/:budgetId/envelopes')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateEnvelopeRequest })
  @ApiCreatedResponse({ type: EnvelopeResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createEnvelopeSchema)) input: CreateEnvelopeInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(contextOf(request).userId, budgetId, input, request.id);
  }

  @Get('budgets/:budgetId/envelopes/summary')
  @ApiOkResponse({ type: EnvelopeSummaryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  summary(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(envelopeSummarySchema)) query: EnvelopeSummaryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.summary(contextOf(request).userId, budgetId, query.status);
  }

  @Get('budgets/:budgetId/envelopes/:envelopeId')
  @ApiOkResponse({ type: EnvelopeResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, envelopeId);
  }

  @Patch('budgets/:budgetId/envelopes/:envelopeId')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: UpdateEnvelopeRequest })
  @ApiOkResponse({ type: EnvelopeResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Body(new ZodValidationPipe(updateEnvelopeSchema)) input: UpdateEnvelopeInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(contextOf(request).userId, budgetId, envelopeId, input, request.id);
  }

  @Post('budgets/:budgetId/envelopes/:envelopeId/archive')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOkResponse({ type: EnvelopeResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  archive(
    @Param('budgetId') budgetId: string,
    @Param('envelopeId') envelopeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.archive(contextOf(request).userId, budgetId, envelopeId, request.id);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
