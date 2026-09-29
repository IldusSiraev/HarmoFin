import {
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../errors/problem-details.dto.js';
import type { RequestContext } from '../request-context/request-context.js';
import { CsrfGuard } from '../security/csrf.guard.js';
import { PlanModelPolicy } from './plan-model.policy.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

export class BudgetModelVersionResponse {
  @ApiProperty({ type: Number, enum: [1, 2], example: 1 })
  planModelVersion!: number;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-09-29' })
  planModelActivatedOn!: string | null;
}

@ApiTags('budget model')
@Controller({ path: 'budgets/:budgetId/model', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class V2BudgetModelController {
  constructor(@Inject(PlanModelPolicy) private readonly policy: PlanModelPolicy) {}

  @Get('')
  @ApiOkResponse({ type: BudgetModelVersionResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  getModel(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.describeModel(budgetId, contextOf(request).userId);
  }

  @Patch('')
  @UseGuards(CsrfGuard)
  @ApiOkResponse({ type: BudgetModelVersionResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  updateModel(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.describeModel(budgetId, contextOf(request).userId);
  }

  private async describeModel(
    budgetId: string,
    userId: string,
  ): Promise<BudgetModelVersionResponse> {
    const budget = await this.policy.requireModel(userId, budgetId, 2);
    return {
      planModelVersion: budget.planModelVersion,
      planModelActivatedOn: budget.planModelActivatedOn
        ? budget.planModelActivatedOn.toISOString().slice(0, 10)
        : null,
    };
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
