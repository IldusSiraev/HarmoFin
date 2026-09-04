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
import { CategoryApplicationService } from './category.application.service.js';
import { CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest } from './category.dto.js';
import {
  createCategorySchema,
  type CreateCategoryInput,
  type ListCategoriesInput,
  listCategoriesSchema,
  type UpdateCategoryInput,
  updateCategorySchema,
} from './category.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('categories')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class CategoryController {
  constructor(
    @Inject(CategoryApplicationService) private readonly service: CategoryApplicationService,
  ) {}

  @Get('budgets/:budgetId/categories')
  @ApiOkResponse({ type: [CategoryResponse] })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listCategoriesSchema)) query: ListCategoriesInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query.type, query.status);
  }

  @Post('budgets/:budgetId/categories')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: CreateCategoryRequest })
  @ApiCreatedResponse({ type: CategoryResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) input: CreateCategoryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(contextOf(request).userId, budgetId, input, request.id);
  }

  @Get('budgets/:budgetId/categories/:categoryId')
  @ApiOkResponse({ type: CategoryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('categoryId') categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, categoryId);
  }

  @Patch('budgets/:budgetId/categories/:categoryId')
  @UseGuards(CsrfGuard)
  @ApiBody({ type: UpdateCategoryRequest })
  @ApiOkResponse({ type: CategoryResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  update(
    @Param('budgetId') budgetId: string,
    @Param('categoryId') categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) input: UpdateCategoryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(contextOf(request).userId, budgetId, categoryId, input, request.id);
  }

  @Post('budgets/:budgetId/categories/:categoryId/archive')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOkResponse({ type: CategoryResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  archive(
    @Param('budgetId') budgetId: string,
    @Param('categoryId') categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.archive(contextOf(request).userId, budgetId, categoryId, request.id);
  }
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
