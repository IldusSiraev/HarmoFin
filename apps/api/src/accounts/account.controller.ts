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
import { AccountApplicationService } from './account.application.service.js';
import { AccountResponse, CreateAccountRequest, UpdateAccountRequest } from './account.dto.js';
import {
  createAccountSchema,
  type CreateAccountInput,
  type ListAccountsInput,
  listAccountsSchema,
  type UpdateAccountInput,
  updateAccountSchema,
} from './account.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('accounts')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class AccountController {
  constructor(
    @Inject(AccountApplicationService) private readonly service: AccountApplicationService,
  ) {}

  @Get('budgets/:budgetId/accounts')
  @ApiOkResponse({ type: [AccountResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listAccountsSchema)) query: ListAccountsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query.status);
  }

  @Post('budgets/:budgetId/accounts')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateAccountRequest })
  @ApiCreatedResponse({ type: AccountResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createAccountSchema)) input: CreateAccountInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(contextOf(request).userId, budgetId, input, request.id);
  }

  @Get('budgets/:budgetId/accounts/:accountId')
  @ApiOkResponse({ type: AccountResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, accountId);
  }

  @Patch('budgets/:budgetId/accounts/:accountId')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: UpdateAccountRequest })
  @ApiOkResponse({ type: AccountResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) input: UpdateAccountInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(contextOf(request).userId, budgetId, accountId, input, request.id);
  }

  @Post('budgets/:budgetId/accounts/:accountId/archive')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOkResponse({ type: AccountResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  archive(
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.archive(contextOf(request).userId, budgetId, accountId, request.id);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
