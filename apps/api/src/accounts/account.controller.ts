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
  ApiOperation,
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
import { AccountApplicationService } from './account.application.service.js';
import {
  AccountResponse,
  AccountSummaryResponse,
  CreateAccountRequest,
  UpdateAccountRequest,
} from './account.dto.js';
import {
  accountSummarySchema,
  createAccountSchema,
  type AccountSummaryInput,
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
  @ApiQuery({ name: 'ownerUserId', required: false, type: String, format: 'uuid' })
  @ApiOkResponse({ type: [AccountResponse] })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listAccountsSchema)) query: ListAccountsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query.status, query.ownerUserId);
  }

  @Get('budgets/:budgetId/accounts/summary')
  @ApiQuery({ name: 'ownerUserId', required: false, type: String, format: 'uuid' })
  @ApiOkResponse({ type: AccountSummaryResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  summary(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(accountSummarySchema)) query: AccountSummaryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.summary(
      contextOf(request).userId,
      budgetId,
      query.status,
      query.ownerUserId,
    );
  }

  @Post('budgets/:budgetId/accounts')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateAccountRequest })
  @ApiCreatedResponse({ type: AccountResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN — нет права записи (нужна роль OWNER или EDITOR).',
  })
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
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN — нет права записи; NOT_OBJECT_OWNER — счёт принадлежит другому участнику.',
  })
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
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN — нет права записи; NOT_OBJECT_OWNER — счёт принадлежит другому участнику.',
  })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  archive(
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.archive(contextOf(request).userId, budgetId, accountId, request.id);
  }

  @Post('budgets/:budgetId/accounts/:accountId/restore')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Восстановление архивированного счёта',
    description:
      'Возвращает архивированный счёт в активное состояние. Доступно только в модели плана v2; ' +
      'счёт должен быть в архиве. Остаток на счёте при восстановлении не проверяется.',
  })
  @ApiOkResponse({ type: AccountResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN — нет права записи; NOT_OBJECT_OWNER — счёт принадлежит другому участнику.',
  })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  restore(
    @Param('budgetId') budgetId: string,
    @Param('accountId') accountId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.restore(contextOf(request).userId, budgetId, accountId, request.id);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
