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
import type { FastifyRequest } from 'fastify';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import { CalendarApplicationService } from './calendar.application.service.js';
import { CalendarEventBody, CalendarEventResponse, CalendarFeedResponse } from './calendar.dto.js';
import {
  calendarEventInputSchema,
  calendarFeedQuerySchema,
  calendarUuidSchema,
  type CalendarEventInput,
  type CalendarFeedQuery,
} from './calendar.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

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

const idPipe = new ZodValidationPipe(calendarUuidSchema);

@ApiTags('calendar (v2)')
@Controller({ path: 'budgets/:budgetId/calendar', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class CalendarController {
  constructor(
    @Inject(CalendarApplicationService) private readonly service: CalendarApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Лента календаря: вхождения событий и платежи планов за диапазон',
    description:
      'Диапазон не больше 62 дней. События разворачиваются по правилу повторения в часовом поясе бюджета; startTime/endTime — локальное время, startsAt/endsAt — UTC. Платежи (kind = PLAN) — те же вхождения и суммы minor units, что у календаря планов, без отменённых и пропущенных; только просмотр. participantUserId — «Мои»: события, где пользователь автор или участник, и платежи его планов. includePlans=false скрывает платежи. Доступно любому активному участнику. Коды: 400 VALIDATION_FAILED, 401, 403, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({ name: 'from', required: true, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: true, schema: { type: 'string', format: 'date' } })
  @ApiQuery({
    name: 'participantUserId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({
    name: 'includePlans',
    required: false,
    schema: { type: 'boolean', default: true },
  })
  @ApiOkResponse({ type: CalendarFeedResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  feed(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(calendarFeedQuerySchema)) query: CalendarFeedQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.feed(contextOf(request).userId, budgetId, query);
  }

  @Get('events/:eventId')
  @ApiOperation({
    summary: 'Событие календаря с правилом повторения',
    description:
      'Дата и время — локальные для часового пояса бюджета. Доступно любому активному участнику; canEdit — только у автора. Коды: 400 VALIDATION_FAILED (некорректный id), 401, 403, 404 RESOURCE_NOT_FOUND (чужой бюджет или удалённое событие), 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiOkResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  getEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getEvent(contextOf(request).userId, budgetId, eventId);
  }

  @Post('events')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Создать событие календаря',
    description:
      'OWNER и EDITOR. Участники — активные члены семьи, прав не дают. Время — в часовом поясе бюджета. Коды: 400 VALIDATION_FAILED (fieldErrors), 401, 403 FORBIDDEN|CSRF_INVALID, 404, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 PARTICIPANT_NOT_MEMBER.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CalendarEventBody })
  @ApiCreatedResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  createEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(calendarEventInputSchema)) input: CalendarEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createEvent(
      contextOf(request).userId,
      budgetId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Patch('events/:eventId')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Изменить событие (всю серию)',
    description:
      'Тело полное, как при создании. Только автор. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|NOT_EVENT_AUTHOR|CSRF_INVALID, 404, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 PARTICIPANT_NOT_MEMBER.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CalendarEventBody })
  @ApiOkResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  updateEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Body(new ZodValidationPipe(calendarEventInputSchema)) input: CalendarEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateEvent(
      contextOf(request).userId,
      budgetId,
      eventId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Удалить событие и все его повторы',
    description:
      'Логическое удаление, только автор. Уже созданные напоминания остаются. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|NOT_EVENT_AUTHOR|CSRF_INVALID, 404, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async deleteEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.deleteEvent(
      contextOf(request).userId,
      budgetId,
      eventId,
      validKey(key),
      request.id,
    );
  }
}
