import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { V2BudgetSettingsApplicationService } from './v2-budget-settings.application.service.js';
import { V2BudgetSettingsRequest, V2BudgetSettingsResponse } from './v2-budget-settings.dto.js';
import {
  type V2BudgetSettingsInput,
  uuidParamSchema,
  v2BudgetSettingsSchema,
} from './v2-budget-settings.schemas.js';

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

@ApiTags('budget settings (v2)')
@Controller({ path: 'budgets/:budgetId/settings', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class V2BudgetSettingsController {
  constructor(
    @Inject(V2BudgetSettingsApplicationService)
    private readonly service: V2BudgetSettingsApplicationService,
  ) {}

  @Patch()
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Изменить имя, политику отрицательного остатка счёта и часовой пояс бюджета',
    description:
      'Хотя бы одно поле. Имя и allowNegativeAccountBalance не вызывают перепланирования и не меняют правило отрицательного виртуального конверта. timezone меняется только пока нет подтверждённых операций, назначений, движений, CONFIRMED целей и ревизий цикла; тогда в той же транзакции удаляются несвязанные UNSET/DRAFT периоды (перестраиваются лениво). Иначе 409 TIMEZONE_CHANGE_REQUIRES_RECONCILIATION без изменений. Повтор с тем же Idempotency-Key возвращает тот же ответ. Только OWNER. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|CSRF_INVALID, 404 бюджет, 409 TIMEZONE_CHANGE_REQUIRES_RECONCILIATION|IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: V2BudgetSettingsRequest })
  @ApiOkResponse({ type: V2BudgetSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN: не OWNER.' })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description:
      'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION, IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.',
  })
  async update(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Body(new ZodValidationPipe(v2BudgetSettingsSchema)) input: V2BudgetSettingsInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.service.update(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
}
