import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
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
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { OnboardingV2ApplicationService } from './onboarding-v2.application.service.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

@ApiTags('onboarding (v2)')
@Controller({ path: 'budgets/:budgetId/onboarding', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class OnboardingV2Controller {
  constructor(
    @Inject(OnboardingV2ApplicationService)
    private readonly service: OnboardingV2ApplicationService,
  ) {}

  @Post('no-mandatory-plans')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Онбординг: обязательных платежей нет',
    description:
      'Отмечает один раз, что в бюджете нет обязательных платежей: шаг «Обязательные платежи» чек-листа считается выполненным (dashboard.onboarding.mandatoryPlansDeclined=true). Денег не двигает, планов не создаёт и не удаляет. Повтор и вызов после уже сделанной отметки — 204 без изменений и без второго audit. Только OWNER. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|CSRF_INVALID, 404 RESOURCE_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiNoContentResponse({ description: 'Отметка сохранена или уже была сохранена.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse, description: 'VALIDATION_FAILED.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN: не OWNER; CSRF_INVALID.',
  })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет не найден или чужой.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.',
  })
  async declineMandatoryPlans(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    await this.service.declineMandatoryPlans(context.userId, budgetId, validKey(key), request.id);
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
