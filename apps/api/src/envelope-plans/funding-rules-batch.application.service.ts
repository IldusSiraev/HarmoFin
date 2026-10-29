import { createHash } from 'node:crypto';

import type { FundingRuleType, Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { assertSuggestionReferences } from '../funding/income-category-suggestion.application.service.js';
import {
  type IncomeCategorySuggestionRecord,
  IncomeCategorySuggestionRepository,
} from '../funding/income-category-suggestion.repository.js';
import { EnvelopePlanRepository } from './envelope-plan.repository.js';
import type { PutFundingRulesBatchInput } from './envelope-plan.schemas.js';
import { changedRuleEnvelopeIds } from './funding-rules-diff.js';
import {
  type FundingRuleBody,
  FundingRuleRepository,
  toRuleBody,
} from './funding-rule.repository.js';

const PUT_FUNDING_RULES_BATCH_OPERATION = 'PUT_FUNDING_RULES_BATCH';
const RUB_SCALE = 2;

type DesiredRule = {
  path: string;
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

function validationFailed(detail: string, field: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

function unprocessable(code: string, detail: string, field: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

/** Server-assigned priorities: queue[i] -> (i + 1) * 10, outside (MANUAL) -> 0. */
function desiredRules(input: PutFundingRulesBatchInput): DesiredRule[] {
  const queue = input.queue.map((item, index): DesiredRule => {
    const path = `queue.${index}`;
    let fixedMinor: bigint | null = null;
    if (item.fixedAmount !== undefined) {
      try {
        // Malformed text ('1.234') throws a 400 without a field path; give it one.
        fixedMinor = parseDecimalToMinorUnits(item.fixedAmount, RUB_SCALE, false);
      } catch {
        throw validationFailed('Некорректный денежный формат.', `${path}.fixedAmount`);
      }
      if (fixedMinor <= 0n) {
        throw validationFailed('Сумма должна быть положительной.', `${path}.fixedAmount`);
      }
    }
    return {
      path,
      envelopeId: item.envelopeId,
      type: item.type,
      priority: (index + 1) * 10,
      fixedMinor,
      percentBasisPoints: item.percentBasisPoints ?? null,
    };
  });
  const outside = input.outside.map((item, index): DesiredRule => ({
    path: `outside.${index}`,
    envelopeId: item.envelopeId,
    type: 'MANUAL',
    priority: 0,
    fixedMinor: null,
    percentBasisPoints: null,
  }));
  return [...queue, ...outside];
}

/**
 * Funding rules of a whole budget: one read of the queue and one atomic save of the queue
 * order, every listed envelope rule and the income-category suggestion. Envelopes absent from
 * the batch keep their rules. Unchanged rules and an unchanged suggestion are not rewritten and
 * get no audit event. Rules are settings: saving them never moves money, never touches
 * assignments, balances or confirmed period targets.
 */
@Injectable()
export class FundingRulesBatchApplicationService {
  private readonly rules = new FundingRuleRepository();
  private readonly envelopes = new EnvelopePlanRepository();
  private readonly suggestions = new IncomeCategorySuggestionRepository();
  private readonly access = new BudgetAccessPolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
  ): Promise<{ status: number; body: { items: FundingRuleBody[] } }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const rules = await this.rules.listRules(tx, budgetId);
      return { status: 200, body: { items: rules.map(toRuleBody) } };
    });
  }

  async putBatch(
    userId: string,
    budgetId: string,
    input: PutFundingRulesBatchInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{
    status: number;
    body: { items: FundingRuleBody[]; incomeSuggestion: IncomeCategorySuggestionRecord };
  }> {
    const desired = desiredRules(input);
    const suggestion = input.incomeSuggestion;
    if (suggestion.enabled && suggestion.sourceCategoryId === null) {
      throw validationFailed(
        'Для включённого предложения нужна категория дохода.',
        'incomeSuggestion.sourceCategoryId',
      );
    }
    if (suggestion.enabled && suggestion.targetEnvelopeId === null) {
      throw validationFailed(
        'Для включённого предложения нужен конверт.',
        'incomeSuggestion.targetEnvelopeId',
      );
    }
    if (!suggestion.enabled && suggestion.sourceCategoryId !== null) {
      throw validationFailed(
        'Для выключенного предложения категория и конверт не передаются.',
        'incomeSuggestion.sourceCategoryId',
      );
    }
    if (!suggestion.enabled && suggestion.targetEnvelopeId !== null) {
      throw validationFailed(
        'Для выключенного предложения категория и конверт не передаются.',
        'incomeSuggestion.targetEnvelopeId',
      );
    }
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          rules: desired.map((rule) => ({
            envelopeId: rule.envelopeId,
            type: rule.type,
            priority: rule.priority,
            fixedMinor: rule.fixedMinor?.toString() ?? null,
            percentBasisPoints: rule.percentBasisPoints,
          })),
          incomeSuggestion: suggestion,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.envelopes.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: PUT_FUNDING_RULES_BATCH_OPERATION,
          requestHash,
        },
        async () => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          this.access.requireWriter(actor);
          await this.assertEnvelopes(tx, budgetId, desired);
          await assertSuggestionReferences(
            tx,
            this.suggestions,
            budgetId,
            suggestion,
            'incomeSuggestion',
          );

          const existingRules = await this.rules.listRules(tx, budgetId);
          const changed = changedRuleEnvelopeIds(existingRules, desired);
          if (changed.length > 0) {
            const owners = await tx.envelope.findMany({
              where: { budgetId, id: { in: changed } },
              select: { ownerUserId: true },
            });
            for (const envelope of owners) this.access.requireObjectOwner(actor, envelope);
          }

          const current = await this.suggestions.find(tx, budgetId, model.workspaceId);
          const unchanged =
            current.enabled === suggestion.enabled &&
            current.sourceCategoryId === suggestion.sourceCategoryId &&
            current.targetEnvelopeId === suggestion.targetEnvelopeId;
          if (!unchanged) this.access.requireBudgetSettings(actor);

          const existing = new Map(existingRules.map((rule) => [rule.envelopeId, rule]));
          for (const rule of desired) {
            if (FundingRuleRepository.same(existing.get(rule.envelopeId), rule)) continue;
            await this.rules.saveRule(tx, {
              budgetId,
              workspaceId: model.workspaceId,
              actorUserId: userId,
              envelopeId: rule.envelopeId,
              type: rule.type,
              priority: rule.priority,
              fixedMinor: rule.fixedMinor,
              percentBasisPoints: rule.percentBasisPoints,
              requestId,
            });
          }

          const savedSuggestion = unchanged
            ? current
            : await this.suggestions.save(tx, {
                budgetId,
                workspaceId: model.workspaceId,
                actorUserId: userId,
                enabled: suggestion.enabled,
                sourceCategoryId: suggestion.sourceCategoryId,
                targetEnvelopeId: suggestion.targetEnvelopeId,
                requestId,
              });

          const items = (await this.rules.listRules(tx, budgetId)).map(toRuleBody);
          return { status: 200, body: { items, incomeSuggestion: savedSuggestion } };
        },
      );
    });
  }

  /** Every batch envelope must belong to this budget (else 404), be active, fit its rule type. */
  private async assertEnvelopes(
    tx: Prisma.TransactionClient,
    budgetId: string,
    desired: DesiredRule[],
  ): Promise<void> {
    const found = new Map(
      (
        await this.envelopes.findManyByIds(
          tx,
          budgetId,
          desired.map((rule) => rule.envelopeId),
        )
      ).map((envelope) => [envelope.id, envelope]),
    );
    for (const rule of desired) {
      const envelope = found.get(rule.envelopeId);
      if (!envelope) throw resourceNotFound();
      if (envelope.archivedAt) {
        throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.', `${rule.path}.envelopeId`);
      }
      if (rule.type === 'SUM_OF_PLANS' && envelope.envelopeType !== 'MANDATORY_EXPENSES') {
        throw unprocessable(
          'FUNDING_RULE_TYPE_NOT_ALLOWED',
          'Правило SUM_OF_PLANS допустимо только для конверта «Обязательные».',
          `${rule.path}.type`,
        );
      }
    }
  }
}
