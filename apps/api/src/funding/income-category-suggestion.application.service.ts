import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type IncomeCategorySuggestionRecord,
  IncomeCategorySuggestionRepository,
} from './income-category-suggestion.repository.js';

const PUT_INCOME_CATEGORY_SUGGESTION_OPERATION = 'PUT_INCOME_CATEGORY_SUGGESTION';

export type PutIncomeCategorySuggestionInput = {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
};

export type IncomeCategorySuggestionBody = IncomeCategorySuggestionRecord;

function validationFailed(detail: string, field: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

function unprocessable(code: string, detail: string, field?: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    detail,
    ...(field ? { fieldErrors: [{ field, message: detail, code: 'invalid' }] } : {}),
  });
}

/**
 * Same-budget checks of the suggestion references: the category must be an active INCOME
 * category and the envelope active. With `fieldPrefix` the 422 errors carry a field path.
 */
export async function assertSuggestionReferences(
  tx: Prisma.TransactionClient,
  repository: IncomeCategorySuggestionRepository,
  budgetId: string,
  input: PutIncomeCategorySuggestionInput,
  fieldPrefix?: string,
): Promise<void> {
  const field = (name: string) => (fieldPrefix ? `${fieldPrefix}.${name}` : undefined);
  if (input.sourceCategoryId !== null) {
    const category = await repository.findCategory(tx, budgetId, input.sourceCategoryId);
    if (!category) throw resourceNotFound();
    if (category.archivedAt) {
      throw unprocessable(
        'CATEGORY_ARCHIVED',
        'Категория архивирована.',
        field('sourceCategoryId'),
      );
    }
    if (category.categoryType !== 'INCOME') {
      throw unprocessable(
        'CATEGORY_TYPE_MISMATCH',
        'Нужна категория дохода.',
        field('sourceCategoryId'),
      );
    }
  }
  if (input.targetEnvelopeId !== null) {
    const envelope = await repository.findEnvelope(tx, budgetId, input.targetEnvelopeId);
    if (!envelope) throw resourceNotFound();
    if (envelope.archivedAt) {
      throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.', field('targetEnvelopeId'));
    }
  }
}

/**
 * Stores the "category of income -> envelope" suggestion setting for model-2 budgets in the
 * existing Budget columns. It is only a setting: it never creates assignments or allocations and
 * never writes legacy income allocations. R03b preview reads it to propose (not write) money.
 */
@Injectable()
export class IncomeCategorySuggestionApplicationService {
  private readonly repository = new IncomeCategorySuggestionRepository();
  private readonly access = new BudgetAccessPolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async put(
    userId: string,
    budgetId: string,
    input: PutIncomeCategorySuggestionInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: IncomeCategorySuggestionBody }> {
    if (input.enabled && input.sourceCategoryId === null) {
      throw validationFailed('Для включённого правила нужна категория дохода.', 'sourceCategoryId');
    }
    if (input.enabled && input.targetEnvelopeId === null) {
      throw validationFailed('Для включённого правила нужен конверт.', 'targetEnvelopeId');
    }
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          enabled: input.enabled,
          sourceCategoryId: input.sourceCategoryId,
          targetEnvelopeId: input.targetEnvelopeId,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: PUT_INCOME_CATEGORY_SUGGESTION_OPERATION,
          requestHash,
        },
        async () => {
          this.access.requireBudgetSettings(
            await requireAccessActor(tx, model.workspaceId, userId),
          );

          await assertSuggestionReferences(tx, this.repository, budgetId, input);

          const body = await this.repository.save(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            enabled: input.enabled,
            sourceCategoryId: input.sourceCategoryId,
            targetEnvelopeId: input.targetEnvelopeId,
            requestId,
          });
          return { status: 200, body };
        },
      );
    });
  }
}
