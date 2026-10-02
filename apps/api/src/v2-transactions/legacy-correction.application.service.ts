import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { IncomeAllocationRepository } from '../allocations/income-allocation.repository.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  DashboardV2ApplicationService,
  type DashboardV2Summary,
} from '../v2-dashboard/dashboard-v2.application.service.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import type { TransactionRecord } from '../transactions/transaction.repository.js';
import {
  LegacyCorrectionRepository,
  type LegacyAllocationRow,
} from './legacy-correction.repository.js';
import type {
  LegacyCorrectionInput,
  LegacyCorrectionPreviewInput,
} from './legacy-correction.schemas.js';

const RUB_SCALE = 2;
const OPERATION = 'legacyCorrection.correct';
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
type Tx = Prisma.TransactionClient;

type Safe = { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
type AllocationView = {
  id: string;
  amountMinor: string;
  status: string;
  envelopeId: string;
  accountId: string;
  occurredOn: string;
};

export type LegacyCorrectionPreview = {
  cashDeltaMinor: string;
  newSafe: Safe;
  newFreeToAssignMinor: string;
  linkedAllocations: AllocationView[];
  allocationResolutionRequired: boolean;
  previewHash: string;
  explanation: string | null;
};

export type LegacyCorrectionResult = {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'CONFIRMED' | 'DELETED';
  amountMinor: string;
  occurredOn: string;
  accountId: string;
  cashDeltaMinor: string;
  accountBalanceMinor: string;
  newSafe: Safe;
  newFreeToAssignMinor: string;
  resolvedAllocations: Array<{ id: string; status: string }>;
  explanation: string | null;
};

/** Thrown inside the preview transaction to roll its hypothetical change back. */
class PreviewRollback extends Error {
  constructor(readonly preview: LegacyCorrectionPreview) {
    super('preview rollback');
  }
}

type Evaluation = {
  current: TransactionRecord;
  workspaceId: string;
  newAmountMinor: bigint;
  deleted: boolean;
  cashDelta: bigint;
  allocations: LegacyAllocationRow[];
  resolutionRequired: boolean;
  before: DashboardV2Summary;
  asOf: string;
  previewHash: string;
};

function conflict(code: string, detail: string): ConflictException {
  return new ConflictException({ code, detail });
}

const notLegacy = () =>
  conflict('NOT_LEGACY_FACT', 'Факт модели 2 исправляется обычным изменением операции.');
const notEditable = () =>
  conflict('TRANSACTION_NOT_EDITABLE', 'Исправить можно только подтверждённую старую операцию.');
const stale = () =>
  conflict(
    'PREVIEW_STALE',
    'Данные изменились после предпросмотра. Повторите предпросмотр и подтвердите заново.',
  );
const resolutionRequired = () =>
  conflict(
    'ALLOCATION_RESOLUTION_REQUIRED',
    'Новая сумма дохода меньше связанных распределений: выберите, отменить их или удалить.',
  );
const resolutionNotRequired = () =>
  conflict(
    'ALLOCATION_RESOLUTION_NOT_REQUIRED',
    'Связанные распределения помещаются в новую сумму: решение по ним не нужно.',
  );
const insufficientBalance = () =>
  conflict('INSUFFICIENT_BALANCE', 'На счёте недостаточно средств для такой правки.');

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

const NBSP_RUB = String.fromCharCode(0xa0, 0x20bd);

function rubles(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const kopecks = abs % 100n;
  const tail = kopecks === 0n ? '' : `,${kopecks.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${whole}${tail}${NBSP_RUB}`;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Explicit OWNER-only correction of an old (accountingModelVersion=1) physical fact in a model-2
 * budget. The ordinary v2 PATCH/DELETE answer 409 LEGACY_CORRECTION_REQUIRED for these facts. The
 * old fact stays outside the v2 ledger: only account cash changes, opening assignments are never
 * rewritten and the old expense is not subtracted from them again.
 */
@Injectable()
export class LegacyCorrectionApplicationService {
  private readonly transactions: TransactionRepository;
  private readonly allocations: IncomeAllocationRepository;
  private readonly corrections = new LegacyCorrectionRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly dashboard: DashboardV2ApplicationService,
  ) {
    this.transactions = new TransactionRepository(prisma);
    this.allocations = new IncomeAllocationRepository(prisma);
  }

  /** Cheap role gate before any lock or idempotency replay; evaluate() re-checks under the lock. */
  private async requireOwner(userId: string, workspaceId: string): Promise<void> {
    const role = await this.transactions.findActiveMemberRole(this.prisma, workspaceId, userId);
    if (role !== 'OWNER') throw forbidden();
  }

  /** Computes the hypothetical result in a transaction that is always rolled back. */
  async preview(
    userId: string,
    budgetId: string,
    transactionId: string,
    input: LegacyCorrectionPreviewInput,
    requestId?: string,
  ): Promise<LegacyCorrectionPreview> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    await this.requireOwner(userId, model.workspaceId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.transactions.lockBudget(tx, budgetId);
        const evaluation = await this.evaluate(
          tx,
          userId,
          budgetId,
          model.workspaceId,
          transactionId,
          input,
        );
        const applied = await this.apply(tx, userId, budgetId, evaluation, undefined, requestId);
        throw new PreviewRollback({
          cashDeltaMinor: formatMinorUnits(evaluation.cashDelta),
          newSafe: applied.safe,
          newFreeToAssignMinor: applied.free,
          linkedAllocations: evaluation.allocations.map(toAllocationView),
          allocationResolutionRequired: evaluation.resolutionRequired,
          previewHash: evaluation.previewHash,
          explanation: explain(evaluation, applied.after),
        });
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof PreviewRollback) return error.preview;
      throw error;
    }
    throw new Error('Preview transaction must roll back.');
  }

  async correct(
    userId: string,
    budgetId: string,
    transactionId: string,
    input: LegacyCorrectionInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<LegacyCorrectionResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    await this.requireOwner(userId, model.workspaceId);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          budgetId,
          transactionId,
          amount: input.amount?.trim() ?? null,
          status: input.status ?? null,
          previewHash: input.previewHash,
          allocationResolution: input.allocationResolution ?? null,
        }),
      )
      .digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.transactions.lockBudget(tx, budgetId);
      return this.idempotency.execute<LegacyCorrectionResult>(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: OPERATION,
          requestHash,
        },
        async () => {
          const evaluation = await this.evaluate(
            tx,
            userId,
            budgetId,
            model.workspaceId,
            transactionId,
            input,
          );
          if (evaluation.previewHash !== input.previewHash) throw stale();
          if (evaluation.resolutionRequired && !input.allocationResolution) {
            throw resolutionRequired();
          }
          if (!evaluation.resolutionRequired && input.allocationResolution) {
            throw resolutionNotRequired();
          }
          const applied = await this.apply(
            tx,
            userId,
            budgetId,
            evaluation,
            input.allocationResolution,
            requestId,
          );
          return { status: 200, body: applied.result };
        },
      );
    }, TX_OPTIONS);
    return result.body;
  }

  /** Role, row, state, same-budget allocations, cash capacity and the preview hash (budget lock held). */
  private async evaluate(
    tx: Tx,
    userId: string,
    budgetId: string,
    workspaceId: string,
    transactionId: string,
    input: LegacyCorrectionPreviewInput,
  ): Promise<Evaluation> {
    const role = await this.transactions.findActiveMemberRole(tx, workspaceId, userId);
    if (role !== 'OWNER') throw forbidden();
    const budget = await this.transactions.findBudgetSettings(tx, budgetId);
    if (!budget) throw resourceNotFound();
    const current = await this.transactions.findForMutation(tx, userId, budgetId, transactionId);
    if (!current) throw resourceNotFound();
    if (current.accountingModelVersion === 2) throw notLegacy();
    if (current.status !== 'CONFIRMED') throw notEditable();

    const deleted = input.status === 'DELETED';
    const newAmountMinor =
      input.amount === undefined
        ? current.amountMinor
        : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    const effective = deleted ? 0n : newAmountMinor;
    if (!deleted && effective === current.amountMinor) {
      throw validationFailed('Новая сумма совпадает с текущей: исправлять нечего.');
    }
    const isIncome = current.transactionType === 'INCOME';
    const cashDelta = isIncome ? effective - current.amountMinor : current.amountMinor - effective;

    let allocations: LegacyAllocationRow[] = [];
    if (isIncome) {
      // Lock then read: same ordering as the v1 lifecycle (transaction row -> allocation rows).
      await this.transactions.findConfirmedAllocationsForIncome(tx, budgetId, current.id);
      allocations = await this.corrections.listConfirmedAllocations(tx, budgetId, current.id);
    }
    const allocated = allocations.reduce((sum, row) => sum + row.amountMinor, 0n);
    const required = isIncome && allocated > effective;

    await this.transactions.lockAccount(tx, budgetId, current.accountId);
    if (!budget.allowNegativeBalance && cashDelta < 0n) {
      const cash = await this.transactions.accountCashBalance(tx, budgetId, current.accountId);
      if (cash + cashDelta < 0n) throw insufficientBalance();
    }

    const asOf = todayInTimezone(new Date(), budget.timezone);
    const before = await this.dashboard.compute(tx, budgetId, workspaceId, userId, asOf);
    const previewHash = createHash('sha256')
      .update(
        JSON.stringify({
          v: 1,
          budgetId,
          transactionId,
          fact: {
            type: current.transactionType,
            status: current.status,
            amountMinor: current.amountMinor.toString(),
            occurredOn: isoDate(current.occurredOn),
            accountId: current.accountId,
            categoryId: current.categoryId,
            envelopeId: current.envelopeId,
          },
          change: { amountMinor: effective.toString(), deleted },
          allocations: allocations.map((row) => [row.id, row.amountMinor.toString(), row.status]),
          before: {
            cash: before.cashMinor,
            free: before.freeToAssignMinor,
            spendable: before.spendable,
          },
        }),
      )
      .digest('hex');

    return {
      current,
      workspaceId,
      newAmountMinor,
      deleted,
      cashDelta,
      allocations,
      resolutionRequired: required,
      before,
      asOf,
      previewHash,
    };
  }

  /** Mutates fact (+ allocations when a resolution is given) and audits; returns the new projection. */
  private async apply(
    tx: Tx,
    userId: string,
    budgetId: string,
    evaluation: Evaluation,
    resolution: 'CANCEL' | 'DELETE' | undefined,
    requestId: string | undefined,
  ): Promise<{
    result: LegacyCorrectionResult;
    safe: Safe;
    free: string;
    after: DashboardV2Summary;
  }> {
    const { current } = evaluation;
    const resolved: Array<{ id: string; status: string }> = [];
    if (resolution) {
      for (const linked of evaluation.allocations) {
        const allocation = await this.allocations.findForMutation(tx, userId, budgetId, linked.id);
        if (!allocation || allocation.status !== 'CONFIRMED') {
          throw conflict('INVALID_TRANSACTION_STATE', 'Состояние распределения изменилось.');
        }
        const next =
          resolution === 'CANCEL'
            ? await this.allocations.cancel(tx, allocation, userId, requestId)
            : await this.allocations.delete(tx, allocation, userId, requestId);
        resolved.push({ id: next.id, status: next.status });
      }
    }

    const updated = evaluation.deleted
      ? await this.transactions.updateLifecycle(tx, current, 'DELETED', userId, requestId)
      : await this.transactions.update(
          tx,
          current,
          { amountMinor: evaluation.newAmountMinor, updatedByUserId: userId },
          userId,
          requestId,
        );
    await this.corrections.createCorrectionAudit(tx, {
      workspaceId: evaluation.workspaceId,
      budgetId,
      transactionId: current.id,
      userId,
      requestId,
      oldValues: { amountMinor: current.amountMinor.toString(), status: current.status },
      newValues: {
        amountMinor: updated.amountMinor.toString(),
        status: updated.status,
        cashDeltaMinor: evaluation.cashDelta.toString(),
        previewHash: evaluation.previewHash,
        allocationResolution: resolution ?? null,
        resolvedAllocationIds: resolved.map((row) => row.id),
      },
    });

    const after = await this.dashboard.compute(
      tx,
      budgetId,
      evaluation.workspaceId,
      userId,
      evaluation.asOf,
    );
    const safe: Safe = {
      state: after.spendable.state,
      amountMinor: after.spendable.amountMinor,
    };
    const explanation = explain(evaluation, after);
    return {
      safe,
      free: after.freeToAssignMinor,
      after,
      result: {
        id: updated.id,
        budgetId,
        transactionType: updated.transactionType,
        status: updated.status === 'DELETED' ? 'DELETED' : 'CONFIRMED',
        amountMinor: formatMinorUnits(updated.amountMinor),
        occurredOn: isoDate(updated.occurredOn),
        accountId: updated.accountId,
        cashDeltaMinor: formatMinorUnits(evaluation.cashDelta),
        accountBalanceMinor: formatMinorUnits(updated.accountCurrentBalanceMinor),
        newSafe: safe,
        newFreeToAssignMinor: after.freeToAssignMinor,
        resolvedAllocations: resolved,
        explanation,
      },
    };
  }
}

function toAllocationView(row: LegacyAllocationRow): AllocationView {
  return {
    id: row.id,
    amountMinor: formatMinorUnits(row.amountMinor),
    status: row.status,
    envelopeId: row.envelopeId,
    accountId: row.accountId,
    occurredOn: isoDate(row.occurredOn),
  };
}

/** Russian explanation when the new cash no longer matches the existing assignments. */
function explain(evaluation: Evaluation, after: DashboardV2Summary): string | null {
  if (evaluation.cashDelta >= 0n) return null;
  const unbacked = BigInt(after.unbackedMinor);
  if (unbacked > 0n) {
    return `Деньги на счетах уменьшатся на ${rubles(-evaluation.cashDelta)}, и назначенные суммы окажутся не обеспечены на ${rubles(unbacked)}. Прежние назначения не изменяются: пересмотрите их и сделайте новое назначение.`;
  }
  if (after.spendable.amountMinor !== evaluation.before.spendable.amountMinor) {
    return `Деньги на счетах уменьшатся на ${rubles(-evaluation.cashDelta)}: безопасная сумма «Можно потратить» станет меньше. Прежние назначения не изменяются.`;
  }
  return null;
}
