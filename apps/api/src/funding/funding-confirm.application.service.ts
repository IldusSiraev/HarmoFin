import { createHash } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import { FundingRuleRepository } from '../envelope-plans/funding-rule.repository.js';
import { FundingPreviewApplicationService } from './funding-preview.application.service.js';
import { FundingPreviewRepository } from './funding-preview.repository.js';
import { computePreviewHash } from './funding-state.js';
import type { FundingConfirmRequestInput } from './funding.schemas.js';

const RUB_SCALE = 2;
const CONFIRM_FUNDING_OPERATION = 'CONFIRM_FUNDING';

export type FundingConfirmResult = {
  status: number;
  body: {
    assignedMinor: string;
    sourceRemainingMinor: string;
    confirmedPeriodIds: string[];
    assignments: Array<{
      id: string;
      envelopeId: string;
      periodId: string | null;
      amountMinor: string;
    }>;
  };
};

type ParsedLine = {
  envelopeId: string;
  periodId: string | null;
  amountMinor: bigint;
  lineId?: string;
};

const positive = (value: bigint) => (value > 0n ? value : 0n);

function previewStale(): ConflictException {
  return new ConflictException({
    code: 'PREVIEW_STALE',
    detail: 'Данные изменились после предпросмотра. Обновите предпросмотр и подтвердите снова.',
  });
}

function sourceExhausted(): ConflictException {
  return new ConflictException({
    code: 'SOURCE_EXHAUSTED',
    detail:
      'Все деньги этого дохода уже распределены; уменьшите суммы строк или отмените существующие распределения.',
  });
}

function insufficientFunds(): ConflictException {
  return new ConflictException({
    code: 'ASSIGNMENT_UNBACKED',
    detail: 'На счетах не хватает денег для такого распределения.',
  });
}

/**
 * Atomic confirmation of a funding preview (R04): target confirmation (R01c) and several
 * assignments in ONE transaction. Lock order: budget row -> idempotency advisory lock -> income row
 * -> (rows locked by confirmDrafts). Money rules mirror L02/L03 (income cap, physical free cash)
 * and are applied line by line over a running simulation before anything is written.
 * Period detection is by envelope.periodSlot (inside preview.compute), stricter than L02's
 * hasPeriods check: it fails closed.
 * Authority: OWNER only (checked before the lock and again under it).
 */
@Injectable()
export class FundingConfirmApplicationService {
  private readonly assignments = new AssignmentRepository();
  private readonly balances = new AssignmentBalanceRepository();
  private readonly rules = new FundingRuleRepository();
  private readonly access = new BudgetAccessPolicy();
  private readonly previewRepository = new FundingPreviewRepository();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly preview: FundingPreviewApplicationService,
  ) {}

  async confirm(
    userId: string,
    budgetId: string,
    input: FundingConfirmRequestInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<FundingConfirmResult> {
    // A zero line is the user's explicit "nothing here": it stays in the hash recompute (it is an
    // override of the preview) but never becomes an assignment.
    const requested: ParsedLine[] = input.lines.map((line) => ({
      envelopeId: line.envelopeId,
      periodId: line.periodId ?? null,
      amountMinor: parseDecimalToMinorUnits(line.amount, RUB_SCALE, false),
      ...(line.lineId !== undefined ? { lineId: line.lineId } : {}),
    }));
    const parsed = requested.filter((line) => line.amountMinor > 0n);
    const targetIds = [...new Set(input.confirmPeriodTargets)];

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const early = await findAccessActor(this.prisma, model.workspaceId, userId);
    if (!early) throw forbidden();
    this.access.requireWriter(early);

    if (parsed.length === 0 && targetIds.length === 0) {
      return {
        status: 200,
        body: {
          assignedMinor: '0',
          sourceRemainingMinor: '0',
          confirmedPeriodIds: [],
          assignments: [],
        },
      };
    }

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          sourceKind: input.sourceKind,
          incomeTransactionId: input.incomeTransactionId ?? null,
          previewHash: input.previewHash,
          targets: [...targetIds].sort(),
          lines: requested.map((line) => [
            line.envelopeId,
            line.periodId,
            line.amountMinor.toString(),
            line.lineId ?? null,
          ]),
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.assignments.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: CONFIRM_FUNDING_OPERATION,
          requestHash,
        },
        async (): Promise<FundingConfirmResult> => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          this.access.requireWriter(actor);

          const incomeId = input.sourceKind === 'INCOME' ? input.incomeTransactionId : undefined;
          if (input.sourceKind === 'INCOME') {
            if (!incomeId) throw resourceNotFound();
            await this.assignments.lockIncome(tx, budgetId, incomeId);
          }
          if (incomeId) {
            this.access.requireIncomeAuthor(
              actor,
              await this.assignments.requireIncome(tx, budgetId, incomeId),
            );
          }
          const guardedEnvelopeIds = new Set<string>(
            input.sourceKind === 'OPENING' ? parsed.map((line) => line.envelopeId) : [],
          );
          const owners = await this.previewRepository.findEnvelopeOwners(
            tx,
            budgetId,
            guardedEnvelopeIds,
            targetIds,
          );
          for (const envelope of owners) this.access.requireObjectOwner(actor, envelope);

          // Same inputs the preview used: lines are the overrides, targets are the selection.
          const { state } = await this.preview.compute(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            userId,
            input: {
              sourceKind: input.sourceKind,
              ...(incomeId ? { incomeTransactionId: incomeId } : {}),
              overrides: input.lines.map((line) => ({
                envelopeId: line.envelopeId,
                ...(line.periodId ? { periodId: line.periodId } : {}),
                ...(line.lineId !== undefined ? { lineId: line.lineId } : {}),
                amount: line.amount,
              })),
              confirmPeriodTargets: targetIds,
            },
            requestId,
          });
          if (computePreviewHash(state) !== input.previewHash) throw previewStale();

          const selected = new Set(state.selectedDraftPeriodIds);
          if (targetIds.some((id) => !selected.has(id))) throw resourceNotFound();

          // Running simulation with L02/L03 semantics; nothing is written until all lines pass.
          const asOfDate = new Date(`${state.asOf}T00:00:00.000Z`);
          const cash = await this.assignments.cashAt(tx, budgetId, asOfDate);
          const rows = await this.balances.allBalances(tx, budgetId, asOfDate);
          const balanceOf = new Map(
            rows.map((row) => [`${row.envelopeId}|${row.periodId ?? ''}`, row.balance]),
          );
          let protectedNow = rows.reduce((sum, row) => sum + positive(row.balance), 0n);
          let incomeAssigned = state.incomeAssignedMinor;
          for (const line of parsed) {
            if (state.incomeAmountMinor !== null) {
              if (incomeAssigned + line.amountMinor > state.incomeAmountMinor) {
                throw sourceExhausted();
              }
              incomeAssigned += line.amountMinor;
            }
            const key = `${line.envelopeId}|${line.periodId ?? ''}`;
            const before = balanceOf.get(key) ?? 0n;
            const after = before + line.amountMinor;
            protectedNow = protectedNow - positive(before) + positive(after);
            if (protectedNow > cash) throw insufficientFunds();
            balanceOf.set(key, after);
          }

          const confirmedPeriodIds = await this.rules.confirmDrafts(
            tx,
            budgetId,
            targetIds,
            userId,
            requestId,
          );

          const created: FundingConfirmResult['body']['assignments'] = [];
          let assigned = 0n;
          for (const line of parsed) {
            const assignment = await this.assignments.createAssignment(tx, {
              budgetId,
              workspaceId: model.workspaceId,
              actorUserId: userId,
              envelopeId: line.envelopeId,
              periodId: line.periodId,
              sourceKind: input.sourceKind,
              amountMinor: line.amountMinor,
              effectiveOn: asOfDate,
              sourceIncomeTransactionId: incomeId ?? null,
              requestId,
            });
            assigned += line.amountMinor;
            created.push({
              id: assignment.id,
              envelopeId: line.envelopeId,
              periodId: line.periodId,
              amountMinor: formatMinorUnits(line.amountMinor),
            });
          }

          const freeAfter = positive(cash - protectedNow);
          const remaining =
            state.incomeAmountMinor !== null
              ? positive(state.incomeAmountMinor - incomeAssigned)
              : freeAfter;
          return {
            status: 200,
            body: {
              assignedMinor: formatMinorUnits(assigned),
              sourceRemainingMinor: formatMinorUnits(remaining < freeAfter ? remaining : freeAfter),
              confirmedPeriodIds,
              assignments: created,
            },
          };
        },
      );
    });
  }
}
