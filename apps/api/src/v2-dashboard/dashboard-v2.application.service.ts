import { Prisma } from '@prisma/client';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { calculateSpendable } from '../common/finance/v2-money.domain.js';
import { formatMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { cycleAndPeriodAt, nextPeriodEndAt } from '../cycles/cycle-settings-at.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardV2Repository } from './dashboard-v2.repository.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ATTEMPTS = 3;
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
const WRITE_ROLES = new Set(['OWNER', 'EDITOR']);

export type DashboardV2Summary = {
  cashMinor: string;
  /** Raw balance of the main period envelope (may be negative). */
  currentBalanceMinor: string;
  /** Raw sum of MANDATORY_EXPENSES envelope balances (may be negative). */
  mandatoryBalanceMinor: string;
  mandatoryDueMinor: string;
  otherProtectedMinor: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  /** Minor-unit string of the DRAFT target of the current main period, else null. */
  suggestedTarget: string | null;
  freeToAssignMinor: string;
  unbackedMinor: string;
  mandatoryGapMinor: string;
  /** `periodId` is the current main period row (null when the budget has no main envelope). */
  period: { start: string; end: string; periodId: string | null };
  /** Last day of the mandatory-protection horizon (end of the next period). */
  horizonEnd: string;
  upcoming: Array<{ occurrenceId: string; scheduledOn: string; unpaidMinor: string }>;
};

function invalidDate(): BadRequestException {
  const detail = 'Дата расчёта должна быть корректной датой в формате YYYY-MM-DD.';
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field: 'asOf', message: detail, code: 'invalid' }],
  });
}

function assertAsOf(value: string): void {
  const parsed = DATE_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalidDate();
  }
}

/** A UTC instant whose calendar day in `timezone` is `date` (balance queries convert it back). */
function instantForLocalDate(date: string, timezone: string): Date {
  for (const hour of ['12', '00', '06', '18']) {
    const candidate = new Date(`${date}T${hour}:00:00.000Z`);
    if (todayInTimezone(candidate, timezone) === date) return candidate;
  }
  return new Date(`${date}T12:00:00.000Z`);
}

function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const meta = error.meta as { code?: unknown } | undefined;
  return error.code === 'P2010' && meta?.code === '40001';
}

const positive = (value: bigint) => (value > 0n ? value : 0n);

/**
 * One consistent server-side projection of the safe spendable number (spec v2.2 section 8).
 * The read is one RepeatableRead READ ONLY transaction without locks (cash, balances and mandatory
 * need come from one snapshot), available to any active member (VIEWER too). The only write is the
 * OWNER/EDITOR pre-step (prepareCurrentPeriod).
 */
@Injectable()
export class DashboardV2ApplicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly repository: DashboardV2Repository = new DashboardV2Repository(prisma),
  ) {}

  async summary(userId: string, budgetId: string, asOf: string): Promise<DashboardV2Summary> {
    assertAsOf(asOf);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    await this.retry(() => this.prepareCurrentPeriod(budgetId, model.workspaceId, userId, asOf));
    return this.retry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return this.compute(tx, budgetId, model.workspaceId, asOf);
        },
        { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  private async retry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isSerializationFailure(error)) throw error;
      }
    }
  }

  /**
   * Pre-step, only for OWNER/EDITOR and only when asOf lies in the period containing today: if the
   * main period row is missing, a short separate transaction takes the budget lock, creates the
   * structural UNSET/DRAFT row (idempotent, with its structural audit) and materializes occurrences
   * of the protection horizon. The read that follows never locks and never writes.
   */
  private async prepareCurrentPeriod(
    budgetId: string,
    workspaceId: string,
    userId: string,
    asOf: string,
  ): Promise<void> {
    const repo = this.repository;
    await this.prisma.$transaction(async (tx) => {
      const role = await repo.memberRole(tx, workspaceId, userId);
      if (!role || !WRITE_ROLES.has(role)) return;
      const settings = await repo.budgetSettings(tx, budgetId, workspaceId);
      if (!settings) return;
      const today = todayInTimezone(new Date(), settings.timezone);
      const current = (await cycleAndPeriodAt(tx, budgetId, today, settings)).period;
      if (asOf < current.start || asOf > current.end) return;
      const main = (await repo.listEnvelopes(tx, budgetId)).find(
        (envelope) =>
          envelope.envelopeType === 'CURRENT_EXPENSES' &&
          envelope.archivedAt === null &&
          envelope.periodSlot === current.id,
      );
      if (!main) return;
      if (await repo.findPeriodByStart(tx, budgetId, main.id, current.start)) return;
      await repo.lockBudget(tx, budgetId);
      await repo.openMainPeriod(tx, budgetId, main.id, current.start, current.end, {
        workspaceId,
        userId,
      });
      const horizonEnd = await nextPeriodEndAt(tx, budgetId, today, settings);
      await repo.materializeOccurrences(tx, budgetId, today, horizonEnd);
    }, TX_OPTIONS);
  }

  private async compute(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
    asOf: string,
  ): Promise<DashboardV2Summary> {
    const repo = this.repository;
    const settings = await repo.budgetSettings(tx, budgetId, workspaceId);
    if (!settings) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Бюджет не найден или недоступен для этого пользователя.',
      });
    }
    const { period } = await cycleAndPeriodAt(tx, budgetId, asOf, settings);
    const horizonEnd = await nextPeriodEndAt(tx, budgetId, asOf, settings);
    const envelopes = await repo.listEnvelopes(tx, budgetId);
    const typeOf = new Map(envelopes.map((envelope) => [envelope.id, envelope.envelopeType]));
    const main = envelopes.find(
      (envelope) =>
        envelope.envelopeType === 'CURRENT_EXPENSES' &&
        envelope.archivedAt === null &&
        envelope.periodSlot === period.id,
    );
    const periodRow = main
      ? await repo.findPeriodByStart(tx, budgetId, main.id, period.start)
      : null;

    const instant = instantForLocalDate(asOf, settings.timezone);
    const cash = await repo.cash(tx, budgetId, instant);
    const rows = await repo.balances(tx, budgetId, instant);
    const upcoming = await repo.upcoming(tx, budgetId, horizonEnd);
    const due = upcoming.reduce((sum, item) => sum + item.unpaidMinor, 0n);

    let mainFunded = 0n;
    let mainBalance = 0n;
    let mandatoryBalance = 0n;
    const otherBalances: bigint[] = [];
    for (const row of rows) {
      if (periodRow && row.envelopeId === periodRow.envelopeId && row.periodId === periodRow.id) {
        mainFunded = row.funded;
        mainBalance = row.balance;
      } else if (typeOf.get(row.envelopeId) === 'MANDATORY_EXPENSES') {
        mandatoryBalance += row.balance;
      } else {
        otherBalances.push(row.balance);
      }
    }
    const otherProtected = otherBalances.reduce((sum, balance) => sum + positive(balance), 0n);

    const result = calculateSpendable({
      cash,
      current: mainBalance,
      mandatory: mandatoryBalance,
      mandatoryDue: due,
      otherBalances,
    });

    const needsSetup =
      !periodRow ||
      ((periodRow.targetStatus === 'UNSET' || periodRow.targetStatus === 'DRAFT') &&
        mainFunded === 0n);
    const suggested =
      periodRow?.targetStatus === 'DRAFT' && periodRow.targetMinor !== null
        ? formatMinorUnits(periodRow.targetMinor)
        : null;

    return {
      cashMinor: formatMinorUnits(cash),
      currentBalanceMinor: formatMinorUnits(mainBalance),
      mandatoryBalanceMinor: formatMinorUnits(mandatoryBalance),
      mandatoryDueMinor: formatMinorUnits(due),
      otherProtectedMinor: formatMinorUnits(otherProtected),
      spendable: needsSetup
        ? { state: 'NEEDS_PERIOD_SETUP', amountMinor: null }
        : { state: 'READY', amountMinor: formatMinorUnits(result.spendableNow) },
      suggestedTarget: needsSetup ? suggested : null,
      freeToAssignMinor: formatMinorUnits(result.freeToAssign),
      unbackedMinor: formatMinorUnits(result.unbackedAssignments),
      mandatoryGapMinor: formatMinorUnits(result.mandatoryGap),
      period: { start: period.start, end: period.end, periodId: periodRow?.id ?? null },
      horizonEnd,
      upcoming: upcoming.map((item) => ({
        occurrenceId: item.occurrenceId,
        scheduledOn: item.scheduledOn,
        unpaidMinor: formatMinorUnits(item.unpaidMinor),
      })),
    };
  }
}
