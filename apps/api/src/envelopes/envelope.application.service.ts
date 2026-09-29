import { type EnvelopeType, type PeriodSlot } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';

import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import {
  EnvelopeRepository,
  type EnvelopeCreateData,
  type EnvelopeRecord,
  type EnvelopeUpdateData,
} from './envelope.repository.js';
import type { CreateEnvelopeInput, UpdateEnvelopeInput } from './envelope.schemas.js';

// The order the UI shows groups in: the client must not invent it.
const ENVELOPE_TYPE_ORDER = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
] as const;

export interface EnvelopeView {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  envelopeType:
    | 'CURRENT_EXPENSES'
    | 'MANDATORY_EXPENSES'
    | 'SAVINGS_GOAL'
    | 'RESERVE'
    | 'FREE_MONEY'
    | 'CUSTOM';
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  monthlyPlannedAmountMinor: string | null;
  targetAmountMinor: string | null;
  targetDate: string | null;
  periodSlot: 'FIRST' | 'SECOND' | null;
  displayOrder: number;
  comment: string | null;
  archivedAt: string | null;
}

export interface EnvelopeSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
  byType: Array<{
    envelopeType: (typeof ENVELOPE_TYPE_ORDER)[number];
    totalMinor: string;
    count: number;
  }>;
}

export interface EnvelopeReallocationSummaryRow {
  reallocationId: string;
  direction: 'IN' | 'OUT';
  otherEnvelopeId: string;
  otherEnvelopeName: string | null;
  amountMinor: string;
  occurredOn: string;
  comment: string | null;
}

export interface EnvelopeBalanceSummaryView {
  envelope: EnvelopeView;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  incomeAllocatedMinor: string;
  expensesMinor: string;
  envelopeTransfersNetMinor: string;
  reallocationsNetMinor: string;
  currentBalanceMinor: string;
  reallocations: EnvelopeReallocationSummaryRow[];
}

@Injectable()
export class EnvelopeApplicationService {
  constructor(
    private readonly repository: EnvelopeRepository,
    private readonly rolePolicy: RolePolicy,
    private readonly planModelPolicy?: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<EnvelopeView[]> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return (await this.repository.list(userId, budgetId, status)).map((envelope) =>
      this.toView(envelope),
    );
  }

  async summary(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<EnvelopeSummaryView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const envelopes = await this.repository.list(userId, budgetId, status);

    const totals = new Map<string, { totalMinor: bigint; count: number }>();
    let totalMinor = 0n;
    for (const envelope of envelopes) {
      totalMinor += envelope.currentBalanceMinor;
      const current = totals.get(envelope.envelopeType) ?? { totalMinor: 0n, count: 0 };
      totals.set(envelope.envelopeType, {
        totalMinor: current.totalMinor + envelope.currentBalanceMinor,
        count: current.count + 1,
      });
    }

    return {
      currency: 'RUB',
      scale: 2,
      totalMinor: formatMinorUnits(totalMinor),
      count: envelopes.length,
      byType: ENVELOPE_TYPE_ORDER.flatMap((envelopeType) => {
        const group = totals.get(envelopeType);
        return group === undefined
          ? []
          : [{ envelopeType, totalMinor: formatMinorUnits(group.totalMinor), count: group.count }];
      }),
    };
  }

  async get(userId: string, budgetId: string, envelopeId: string): Promise<EnvelopeView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const envelope = await this.repository.find(userId, budgetId, envelopeId);
    if (!envelope) throw resourceNotFound();
    return this.toView(envelope);
  }

  async balanceSummary(
    userId: string,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopeBalanceSummaryView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const record = await this.repository.balanceSummary(userId, budgetId, envelopeId);
    if (!record) throw resourceNotFound();
    const { envelope, terms, reallocations } = record;
    const currentBalanceMinor =
      terms.startingBalanceMinor +
      terms.incomeAllocatedMinor -
      terms.expensesMinor +
      terms.envelopeTransfersNetMinor +
      terms.reallocationsNetMinor;

    return {
      envelope: this.toView({ ...envelope, currentBalanceMinor }),
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: formatMinorUnits(terms.startingBalanceMinor),
      incomeAllocatedMinor: formatMinorUnits(terms.incomeAllocatedMinor),
      expensesMinor: formatMinorUnits(terms.expensesMinor),
      envelopeTransfersNetMinor: formatMinorUnits(terms.envelopeTransfersNetMinor),
      reallocationsNetMinor: formatMinorUnits(terms.reallocationsNetMinor),
      currentBalanceMinor: formatMinorUnits(currentBalanceMinor),
      reallocations: reallocations.map((row) => ({
        reallocationId: row.reallocationId,
        direction: row.direction,
        otherEnvelopeId: row.otherEnvelopeId,
        otherEnvelopeName: row.otherEnvelopeName,
        amountMinor: formatMinorUnits(row.amountMinor),
        occurredOn: row.occurredOn.slice(0, 10),
        comment: row.comment,
      })),
    };
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateEnvelopeInput,
    requestId?: string,
  ): Promise<EnvelopeView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const budget = await this.requireOwnerBudget(userId, budgetId);
    const envelope = await this.repository.create(
      userId,
      this.createData(budgetId, input, budget.allowNegativeBalance),
      requestId,
    );
    if (!envelope) throw resourceNotFound();
    return this.toView(envelope);
  }

  async update(
    userId: string,
    budgetId: string,
    envelopeId: string,
    input: UpdateEnvelopeInput,
    requestId?: string,
  ): Promise<EnvelopeView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    const budget = await this.requireOwnerBudget(userId, budgetId);
    const current = await this.repository.find(userId, budgetId, envelopeId);
    if (!current || current.archivedAt) throw resourceNotFound();

    const envelope = await this.repository.update(
      userId,
      budgetId,
      envelopeId,
      this.updateData(input, current, budget.allowNegativeBalance),
      requestId,
    );
    if (!envelope) throw resourceNotFound();
    return this.toView(envelope);
  }

  async archive(
    userId: string,
    budgetId: string,
    envelopeId: string,
    requestId?: string,
  ): Promise<EnvelopeView> {
    await this.requireBudgetPlanModel(userId, budgetId);
    await this.requireOwnerBudget(userId, budgetId);
    const envelope = await this.repository.archive(userId, budgetId, envelopeId, requestId);
    if (!envelope) throw resourceNotFound();
    return this.toView(envelope);
  }

  toView(envelope: EnvelopeRecord): EnvelopeView {
    const startingBalanceMinor = formatMinorUnits(envelope.startingBalanceMinor);
    return {
      id: envelope.id,
      budgetId: envelope.budgetId,
      templateKey: envelope.templateKey,
      name: envelope.name,
      envelopeType: envelope.envelopeType,
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor,
      currentBalanceMinor: formatMinorUnits(envelope.currentBalanceMinor),
      monthlyPlannedAmountMinor:
        envelope.monthlyPlannedAmountMinor === null
          ? null
          : formatMinorUnits(envelope.monthlyPlannedAmountMinor),
      targetAmountMinor:
        envelope.targetAmountMinor === null ? null : formatMinorUnits(envelope.targetAmountMinor),
      targetDate: envelope.targetDate === null ? null : formatDate(envelope.targetDate),
      periodSlot: envelope.periodSlot,
      displayOrder: envelope.displayOrder,
      comment: envelope.comment,
      archivedAt: envelope.archivedAt?.toISOString() ?? null,
    };
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
    return budget;
  }

  private async requireBudgetPlanModel(userId: string, budgetId: string): Promise<void> {
    const policy = this.planModelPolicy;
    if (policy) await policy.requireModel(userId, budgetId, 1);
  }

  private createData(
    budgetId: string,
    input: CreateEnvelopeInput,
    allowNegativeBalance: boolean,
  ): EnvelopeCreateData {
    const targetAmountMinor = parseOptionalMoney(input.targetAmount);
    const targetDate =
      input.targetDate === undefined || input.targetDate === null
        ? null
        : parseDate(input.targetDate);
    validateTarget(targetAmountMinor, targetDate);

    return {
      budgetId,
      name: input.name,
      envelopeType: input.envelopeType,
      periodSlot: periodSlotFor(input.envelopeType, input.periodSlot ?? null),
      currency: input.currency,
      startingBalanceMinor: parseDecimalToMinorUnits(
        input.startingBalance,
        2,
        allowNegativeBalance,
      ),
      monthlyPlannedAmountMinor: parseOptionalMoney(input.monthlyPlannedAmount),
      targetAmountMinor,
      targetDate,
      displayOrder: input.displayOrder,
      comment: input.comment ?? null,
    };
  }

  private updateData(
    input: UpdateEnvelopeInput,
    current: EnvelopeRecord,
    allowNegativeBalance: boolean,
  ): EnvelopeUpdateData {
    const targetAmountMinor =
      input.targetAmount === undefined
        ? current.targetAmountMinor
        : parseOptionalMoney(input.targetAmount);
    const targetDate =
      input.targetDate === undefined
        ? current.targetDate
        : input.targetDate === null
          ? null
          : parseDate(input.targetDate);
    const envelopeType = input.envelopeType ?? current.envelopeType;
    const requestedPeriodSlot =
      input.periodSlot === undefined ? current.periodSlot : input.periodSlot;
    const periodSlot =
      envelopeType === 'CURRENT_EXPENSES'
        ? requestedPeriodSlot
        : input.periodSlot === undefined
          ? null
          : periodSlotFor(envelopeType, requestedPeriodSlot);
    validateTarget(targetAmountMinor, targetDate);

    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.envelopeType !== undefined ? { envelopeType } : {}),
      ...(input.periodSlot !== undefined ||
      (input.envelopeType !== undefined && envelopeType !== current.envelopeType)
        ? { periodSlot }
        : {}),
      ...(input.startingBalance !== undefined
        ? {
            startingBalanceMinor: parseDecimalToMinorUnits(
              input.startingBalance,
              2,
              allowNegativeBalance,
            ),
          }
        : {}),
      ...(input.monthlyPlannedAmount !== undefined
        ? { monthlyPlannedAmountMinor: parseOptionalMoney(input.monthlyPlannedAmount) }
        : {}),
      ...(input.targetAmount !== undefined ? { targetAmountMinor } : {}),
      ...(input.targetDate !== undefined ? { targetDate } : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    };
  }
}

function parseOptionalMoney(value: string | null | undefined): bigint | null {
  return value === undefined || value === null ? null : parseDecimalToMinorUnits(value, 2, false);
}

function validateTarget(targetAmountMinor: bigint | null, targetDate: Date | null): void {
  if (targetDate !== null && targetAmountMinor === null) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Целевая дата требует целевой суммы.',
      fieldErrors: [
        {
          field: 'targetDate',
          message: 'Укажите целевую сумму для целевой даты.',
          code: 'invalid',
        },
      ],
    });
  }
}

function periodSlotFor(
  envelopeType: EnvelopeType,
  periodSlot: PeriodSlot | null,
): PeriodSlot | null {
  if (periodSlot !== null && envelopeType !== 'CURRENT_EXPENSES') {
    throw new BadRequestException({
      code: 'REFERENCE_INVALID',
      detail: 'Слот периода доступен только для конверта текущих расходов.',
      fieldErrors: [
        {
          field: 'periodSlot',
          message: 'Выберите тип «Текущие расходы» для слота периода.',
          code: 'invalid',
        },
      ],
    });
  }
  return periodSlot;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
