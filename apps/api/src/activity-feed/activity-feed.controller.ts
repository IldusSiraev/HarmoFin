import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ActivityFeedApplicationService } from './activity-feed.application.service.js';
import { ActivityFeedResponse, ActivityFeedSeenResponse } from './activity-feed.dto.js';
import {
  activityFeedQuerySchema,
  activityUuidSchema,
  type ActivityFeedQuery,
} from './activity-feed.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

const idPipe = new ZodValidationPipe(activityUuidSchema);

@ApiTags('activity (v2)')
@Controller({ path: 'budgets/:budgetId/activity', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ActivityFeedController {
  constructor(
    @Inject(ActivityFeedApplicationService)
    private readonly service: ActivityFeedApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Лента семьи: что сделали другие участники за 30 дней',
    description:
      'Записи аудита бюджета по белому списку (операции, переводы, конверты, платежи и планы, календарь, состав семьи), без собственных действий и действий без автора; сортировка от новых к старым. isNew и unseenCount считаются от отметки «просмотрено», без отметки — за 7 дней. Суммы — minor units из записей аудита, без пересчёта. Доступно любому активному участнику. Коды: 400 VALIDATION_FAILED (limit, actorId, cursor), 401, 403, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 30, default: 30 },
  })
  @ApiQuery({ name: 'actorId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', maxLength: 512 } })
  @ApiOkResponse({ type: ActivityFeedResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  list(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(activityFeedQuerySchema)) query: ActivityFeedQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('seen')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Отметить ленту просмотренной',
    description:
      'Ставит отметку текущего пользователя на время сервера; отметка только растёт. Повтор безопасен, Idempotency-Key не нужен: запрос не создаёт финансовых записей. Доступно любому активному участнику, включая наблюдателя. Коды: 400 VALIDATION_FAILED (некорректный budgetId), 401, 403 CSRF_INVALID, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiOkResponse({ type: ActivityFeedSeenResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  seen(@Param('budgetId', idPipe) budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.service.markSeen(contextOf(request).userId, budgetId);
  }
}
