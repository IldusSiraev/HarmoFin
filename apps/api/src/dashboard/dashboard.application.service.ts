import { Injectable } from '@nestjs/common';

import { cycleAndPeriodFor, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { formatMinorUnits } from '../common/money/minor-units.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { DashboardRepository } from './dashboard.repository.js';

export type DashboardSummary = {
  cycle: { start: string; end: string };
  period: { id: 'FIRST' | 'SECOND'; start: string; end: string };
  totalAccountMoneyMinor: string;
  accounts: Array<{ id: string; name: string; balanceMinor: string }>;
  envelopes: Array<{ id: string; name: string; balanceMinor: string }>;
  unallocatedIncomeMinor: string;
  unassignedStartingBalanceMinor: string;
  onboarding: {
    categoriesSeeded: boolean;
    cycleConfigured: boolean;
    hasAccounts: boolean;
    hasEnvelopeStartingBalances: boolean;
    hasAllocatedIncome: boolean;
  };
  periodLimit:
    | {
        state: 'available';
        envelopeId: string;
        limitMinor: string;
        spentMinor: string;
        remainingMinor: string;
        daysUntilBoundary: number;
        averageRemainingDailyLimitMinor: string;
      }
    | { state: 'unavailable' };
  previousPeriodLeftover: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: string;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null;
  warnings: Array<{ subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: string }>;
  upcomingObligations: Array<{
    occurrenceId: string;
    planName: string;
    scheduledOn: string;
    amountMinor: string;
    currency: 'RUB';
    scale: 2;
    status: 'PENDING' | 'DUE';
    envelopeId: string | null;
    actionPath: string;
  }>;
};

@Injectable()
export class DashboardApplicationService {
  constructor(private readonly repository: DashboardRepository) {}

  async currentSummary(userId: string, budgetId: string): Promise<DashboardSummary> {
    const budget = await this.repository.findAccessible(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return this.summary(userId, budgetId, todayInTimezone(new Date(), budget.timezone));
  }

  async summary(userId: string, budgetId: string, asOf: string): Promise<DashboardSummary> {
    const budget = await this.repository.findAccessible(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const range = cycleAndPeriodFor(budget, asOf);
    const values = await this.repository.summary(
      userId,
      budgetId,
      {
        id: range.period.id,
        start: dateValue(range.period.start),
        end: dateValue(range.period.end),
      },
      dateValue(asOf),
    );
    const periodLimit = values.periodEnvelope
      ? periodLimitView(values.periodEnvelope, range.daysUntilNextBoundary)
      : { state: 'unavailable' as const };

    return {
      cycle: range.cycle,
      period: range.period,
      totalAccountMoneyMinor: formatMinorUnits(values.totalAccountMoneyMinor),
      accounts: values.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        balanceMinor: formatMinorUnits(account.balanceMinor),
      })),
      envelopes: values.envelopes.map((envelope) => ({
        id: envelope.id,
        name: envelope.name,
        balanceMinor: formatMinorUnits(envelope.balanceMinor),
      })),
      unallocatedIncomeMinor: formatMinorUnits(values.unallocatedIncomeMinor),
      unassignedStartingBalanceMinor: formatMinorUnits(values.unassignedStartingBalanceMinor),
      onboarding: {
        categoriesSeeded: values.onboarding.categoriesSeeded,
        cycleConfigured: budget.cycleStartDay !== 1 || budget.periodBoundaryOffset !== 15,
        hasAccounts: values.onboarding.hasAccounts,
        hasEnvelopeStartingBalances: values.onboarding.hasEnvelopeStartingBalances,
        hasAllocatedIncome: values.onboarding.hasAllocatedIncome,
      },
      periodLimit,
      previousPeriodLeftover: previousPeriodLeftoverView(
        values.previousPeriodLeftover,
        budget.allowNegativeBalance,
      ),
      warnings: values.warnings.map((warning) => ({
        subject: warning.subject,
        id: warning.id,
        balanceMinor: formatMinorUnits(warning.balanceMinor),
      })),
      upcomingObligations: values.upcomingObligations.map((occurrence) => ({
        occurrenceId: occurrence.occurrenceId,
        planName: occurrence.planName,
        scheduledOn: occurrence.scheduledOn.toISOString().slice(0, 10),
        amountMinor: formatMinorUnits(occurrence.amountMinor),
        currency: 'RUB',
        scale: 2,
        status: occurrence.status,
        envelopeId: occurrence.envelopeId,
        actionPath: `/app/plans?occurrence=${occurrence.occurrenceId}`,
      })),
    };
  }
}

function periodLimitView(
  value: {
    id: string;
    openingMinor: bigint;
    allocatedMinor: bigint;
    reallocatedMinor: bigint;
    spentMinor: bigint;
  },
  daysUntilBoundary: number,
) {
  const limitMinor = value.openingMinor + value.allocatedMinor + value.reallocatedMinor;
  const remainingMinor = limitMinor - value.spentMinor;
  return {
    state: 'available' as const,
    envelopeId: value.id,
    limitMinor: formatMinorUnits(limitMinor),
    spentMinor: formatMinorUnits(value.spentMinor),
    remainingMinor: formatMinorUnits(remainingMinor),
    daysUntilBoundary,
    averageRemainingDailyLimitMinor: formatMinorUnits(
      daysUntilBoundary > 0 ? remainingMinor / BigInt(daysUntilBoundary) : remainingMinor,
    ),
  };
}

function previousPeriodLeftoverView(
  value: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: bigint;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null,
  allowNegativeBalance: boolean,
) {
  if (!value) return null;
  const worthShowing = value.balanceMinor > 0n || (allowNegativeBalance && value.balanceMinor < 0n);
  if (!worthShowing) return null;
  return {
    envelopeId: value.envelopeId,
    envelopeName: value.envelopeName,
    balanceMinor: formatMinorUnits(value.balanceMinor),
    currentPeriodEnvelopeId: value.currentPeriodEnvelopeId,
    currentPeriodEnvelopeName: value.currentPeriodEnvelopeName,
  };
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
