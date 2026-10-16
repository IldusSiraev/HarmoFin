import { type EnvelopeType, Prisma } from '@prisma/client';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { calculateSpendable } from '../common/finance/v2-money.domain.js';
import { formatMinorUnits } from '../common/money/minor-units.js';
import { mandatorySliceGaps } from '../obligations/mandatory-due.domain.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { addIsoDays, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { cycleAndPeriodAt, nextPeriodEndAt } from '../cycles/cycle-settings-at.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardV2Repository } from './dashboard-v2.repository.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ATTEMPTS = 3;
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
const WRITE_ROLES = new Set(['OWNER', 'EDITOR']);
const NEAREST_OBLIGATIONS_LIMIT = 3;
const NEAREST_OBLIGATIONS_DAYS = 60;
const DAY_MS = 86_400_000;

export type DashboardV2Summary = {
  cashMinor: string;
  /** Raw balance of the main period envelope (may be negative). */
  currentBalanceMinor: string;
  /** Raw sum of MANDATORY_EXPENSES envelope balances (may be negative). */
  mandatoryBalanceMinor: string;
  mandatoryDueMinor: string;
  /** Unpaid mandatory slice of the current period (includes overdue). */
  mandatoryDueCurrentMinor: string;
  /** Unpaid mandatory slice of the next period. */
  mandatoryDueNextMinor: string;
  otherProtectedMinor: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  /** Minor-unit string of the DRAFT target of the current main period, else null. */
  suggestedTarget: string | null;
  freeToAssignMinor: string;
  unbackedMinor: string;
  mandatoryGapMinor: string;
  /** Uncovered part of the mandatory need that falls on the current period (including overdue). */
  mandatoryGapCurrentMinor: string;
  /** Uncovered part of the mandatory need that falls on the next period. */
  mandatoryGapNextMinor: string;
  /** `periodId` is the current main period row (null when the budget has no main envelope). */
  period: { start: string; end: string; periodId: string | null };
  /** Financial month containing `asOf` (clipped at the next settings revision). */
  cycle: { start: string; end: string };
  /** Calculation date: today in the budget timezone unless the caller passed `asOf`. */
  asOf: string;
  /** Last day of the mandatory-protection horizon (end of the next period). */
  horizonEnd: string;
  upcoming: Array<{ occurrenceId: string; scheduledOn: string; unpaidMinor: string }>;
  /** The nearest open mandatory payments (display list, up to 60 days), overdue first. */
  nearestObligations: Array<{
    occurrenceId: string;
    name: string;
    scheduledOn: string;
    unpaidMinor: string;
  }>;
  /** Current main period figures; null while the period limit is not set up. */
  periodStats: {
    spentMinor: string;
    /** Everything the main period envelope held: balance plus spent. */
    availableMinor: string;
    /** Days from asOf to the period end, both included. */
    daysLeft: number;
    /** Spendable divided by days left, rounded down to a minor unit; 0 when nothing is spendable. */
    averagePerDayMinor: string;
  } | null;
  /** Envelope balances (all periods summed); archived ones only while they still hold money. */
  envelopes: Array<{
    id: string;
    name: string;
    envelopeType: EnvelopeType;
    periodSlot: 'FIRST' | 'SECOND' | null;
    balanceMinor: string;
  }>;
  envelopesTotalMinor: string;
  /**
   * True when the unpaid mandatory total may miss occurrences: the reader cannot materialize them
   * (VIEWER) or asOf is outside the period containing today (nothing materialized for it).
   */
  dueMayBeIncomplete: boolean;
  accounts: Array<{ id: string; name: string; balanceMinor: string }>;
  /** Positive assignment balances held outside the current main period (mandatory, savings, leftovers). */
  protectedAssignments: DashboardV2ProtectedAssignment[];
  warnings: DashboardV2Warning[];
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    needsOpeningAssignment: boolean;
    needsPeriodSetup: boolean;
    hasMandatoryPlans: boolean;
    mandatoryPlansDeclined: boolean;
  };
};

export type DashboardV2ProtectedAssignment = {
  envelopeId: string;
  envelopeName: string;
  envelopeType: EnvelopeType;
  periodId: string | null;
  balanceMinor: string;
};

export type DashboardV2Warning = {
  kind: 'PERIOD' | 'COVERAGE';
  code: 'PERIOD_LEFTOVER' | 'PERIOD_DEFICIT' | 'MANDATORY_GAP' | 'CASH_SHORTFALL';
  /** Optional severity for MANDATORY_GAP: ALERT when the current period is short, INFO when only the next. */
  level?: 'ALERT' | 'INFO';
  /** Russian text status so the state never relies on colour alone. */
  message: string;
  amountMinor: string;
  envelopeId: string | null;
  periodId: string | null;
  /** Signed envelope balance for PERIOD warnings, null for COVERAGE ones. */
  balanceMinor: string | null;
  actionPath: string;
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

/** Human text for a minor-unit amount: "12 345 ₽" or "12 345,50 ₽" (display text only). */
function rubles(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const kopecks = abs % 100n;
  const tail = kopecks === 0n ? '' : `,${kopecks.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${whole}${tail}\u00a0\u20bd`;
}

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

  /** `asOfInput` defaults to today in the budget timezone. */
  async summary(userId: string, budgetId: string, asOfInput?: string): Promise<DashboardV2Summary> {
    if (asOfInput !== undefined) assertAsOf(asOfInput);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const asOf = asOfInput ?? (await this.todayOf(budgetId, model.workspaceId));
    await this.retry(() => this.prepareCurrentPeriod(budgetId, model.workspaceId, userId, asOf));
    return this.retry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return this.compute(tx, budgetId, model.workspaceId, userId, asOf);
        },
        { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    );
  }

  private async todayOf(budgetId: string, workspaceId: string): Promise<string> {
    const settings = await this.prisma.$transaction((tx) =>
      this.repository.budgetSettings(tx, budgetId, workspaceId),
    );
    if (!settings) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Бюджет не найден или недоступен для этого пользователя.',
      });
    }
    return todayInTimezone(new Date(), settings.timezone);
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
      await repo.materializeOccurrences(tx, budgetId, today, current.end, horizonEnd);
    }, TX_OPTIONS);
  }

  async compute(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
    userId: string,
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
    const { period, cycle } = await cycleAndPeriodAt(tx, budgetId, asOf, settings);
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
    let mainSpent = 0n;
    let mainBalance = 0n;
    let mandatoryBalance = 0n;
    const otherBalances: bigint[] = [];
    for (const row of rows) {
      if (periodRow && row.envelopeId === periodRow.envelopeId && row.periodId === periodRow.id) {
        mainFunded = row.funded;
        mainSpent = row.spent;
        mainBalance = row.balance;
      } else if (typeOf.get(row.envelopeId) === 'MANDATORY_EXPENSES') {
        mandatoryBalance += row.balance;
      } else {
        otherBalances.push(row.balance);
      }
    }
    const otherProtected = otherBalances.reduce((sum, balance) => sum + positive(balance), 0n);

    // Mandatory need split current/next by the period end: only `upcoming` rows (already bounded
    // by the horizon) are used, no extra query.
    const dueCurrent = upcoming
      .filter((item) => item.scheduledOn <= period.end)
      .reduce((sum, item) => sum + item.unpaidMinor, 0n);
    const mandatoryGaps = mandatorySliceGaps(dueCurrent, due - dueCurrent, mandatoryBalance);

    const result = calculateSpendable({
      cash,
      current: mainBalance,
      mandatory: mandatoryBalance,
      mandatoryDueCurrent: dueCurrent,
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

    const today = todayInTimezone(new Date(), settings.timezone);
    const currentPeriod = (await cycleAndPeriodAt(tx, budgetId, today, settings)).period;
    const role = await repo.memberRole(tx, workspaceId, userId);
    const dueMayBeIncomplete =
      !role || !WRITE_ROLES.has(role) || asOf < currentPeriod.start || asOf > currentPeriod.end;

    const envelopeById = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    const isCurrentRow = (row: { envelopeId: string; periodId: string | null }) =>
      periodRow !== null &&
      row.envelopeId === periodRow.envelopeId &&
      row.periodId === periodRow.id;
    const periodRowIds = rows
      .filter((row) => row.periodId !== null && !isCurrentRow(row))
      .map((row) => row.periodId as string);
    const ranges = new Map(
      (await repo.periodRanges(tx, budgetId, periodRowIds)).map((range) => [range.id, range]),
    );

    const protectedAssignments: DashboardV2ProtectedAssignment[] = [];
    const warnings: DashboardV2Warning[] = [];
    for (const row of rows) {
      const envelope = envelopeById.get(row.envelopeId);
      if (!envelope || isCurrentRow(row)) continue;
      if (row.balance > 0n) {
        protectedAssignments.push({
          envelopeId: row.envelopeId,
          envelopeName: envelope.name,
          envelopeType: envelope.envelopeType,
          periodId: row.periodId,
          balanceMinor: formatMinorUnits(row.balance),
        });
      }
      const range = row.periodId ? ranges.get(row.periodId) : undefined;
      if (!range || range.endsOn >= period.start || row.balance === 0n) continue;
      const leftover = row.balance > 0n;
      warnings.push({
        kind: 'PERIOD',
        code: leftover ? 'PERIOD_LEFTOVER' : 'PERIOD_DEFICIT',
        message: leftover
          ? `Остаток прошлого периода ${rubles(row.balance)} ещё не передан: решите, куда его направить.`
          : `Перерасход прошлого периода ${rubles(-row.balance)}: покройте его отдельным назначением.`,
        amountMinor: formatMinorUnits(leftover ? row.balance : -row.balance),
        envelopeId: row.envelopeId,
        periodId: row.periodId,
        balanceMinor: formatMinorUnits(row.balance),
        actionPath: leftover
          ? `/app/envelopes?leftoverPeriod=${row.periodId}`
          : `/app/envelopes?coverPeriod=${row.periodId}`,
      });
    }
    if (mandatoryGaps.currentGapMinor > 0n) {
      warnings.push({
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        level: 'ALERT',
        message: `Не хватает на обязательства ${rubles(mandatoryGaps.currentGapMinor)} до конца периода ${period.end}: можно потратить меньше остатка периода. Покройте обязательства.`,
        amountMinor: formatMinorUnits(mandatoryGaps.currentGapMinor),
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        actionPath: '/app/envelopes?cover=mandatory',
      });
    } else if (mandatoryGaps.nextGapMinor > 0n) {
      warnings.push({
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        level: 'INFO',
        message: `Не хватает на обязательства ${rubles(mandatoryGaps.nextGapMinor)} на следующий период: закладывайте средства заранее.`,
        amountMinor: formatMinorUnits(mandatoryGaps.nextGapMinor),
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        actionPath: '/app/envelopes?cover=mandatory',
      });
    }
    if (result.unbackedAssignments > 0n) {
      warnings.push({
        kind: 'COVERAGE',
        code: 'CASH_SHORTFALL',
        message: `Не хватает денег на счетах ${rubles(result.unbackedAssignments)} для назначенных сумм. Проверьте счета и назначения.`,
        amountMinor: formatMinorUnits(result.unbackedAssignments),
        envelopeId: null,
        periodId: null,
        balanceMinor: null,
        actionPath: '/app/accounts',
      });
    }

    const accounts = await repo.accounts(tx, budgetId, instant);
    const nearest = await repo.nearestObligations(
      tx,
      budgetId,
      addIsoDays(asOf, NEAREST_OBLIGATIONS_DAYS),
      NEAREST_OBLIGATIONS_LIMIT,
    );
    const daysLeft =
      Math.round(
        (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS,
      ) + 1;
    const periodStats = needsSetup
      ? null
      : {
          spentMinor: formatMinorUnits(mainSpent),
          availableMinor: formatMinorUnits(mainBalance + mainSpent),
          daysLeft,
          // Never negative: an overspent period shows 0 per day, not a truncated negative.
          averagePerDayMinor: formatMinorUnits(
            result.spendableNow > 0n ? result.spendableNow / BigInt(daysLeft) : 0n,
          ),
        };
    const balanceByEnvelope = new Map<string, bigint>();
    for (const row of rows) {
      balanceByEnvelope.set(
        row.envelopeId,
        (balanceByEnvelope.get(row.envelopeId) ?? 0n) + row.balance,
      );
    }
    const envelopeList = envelopes
      .map((envelope) => ({ envelope, balance: balanceByEnvelope.get(envelope.id) ?? 0n }))
      .filter(({ envelope, balance }) => envelope.archivedAt === null || balance !== 0n);
    const mandatoryIds = envelopes
      .filter((envelope) => envelope.envelopeType === 'MANDATORY_EXPENSES')
      .map((envelope) => envelope.id);
    const hasAssignments = await repo.hasConfirmedAssignments(tx, budgetId, asOf);

    return {
      cashMinor: formatMinorUnits(cash),
      currentBalanceMinor: formatMinorUnits(mainBalance),
      mandatoryBalanceMinor: formatMinorUnits(mandatoryBalance),
      mandatoryDueMinor: formatMinorUnits(due),
      mandatoryDueCurrentMinor: formatMinorUnits(dueCurrent),
      mandatoryDueNextMinor: formatMinorUnits(due - dueCurrent),
      otherProtectedMinor: formatMinorUnits(otherProtected),
      spendable: needsSetup
        ? { state: 'NEEDS_PERIOD_SETUP', amountMinor: null }
        : { state: 'READY', amountMinor: formatMinorUnits(result.spendableNow) },
      suggestedTarget: needsSetup ? suggested : null,
      freeToAssignMinor: formatMinorUnits(result.freeToAssign),
      unbackedMinor: formatMinorUnits(result.unbackedAssignments),
      mandatoryGapMinor: formatMinorUnits(result.mandatoryGap),
      mandatoryGapCurrentMinor: formatMinorUnits(mandatoryGaps.currentGapMinor),
      mandatoryGapNextMinor: formatMinorUnits(mandatoryGaps.nextGapMinor),
      period: { start: period.start, end: period.end, periodId: periodRow?.id ?? null },
      cycle: { start: cycle.start, end: cycle.end },
      asOf,
      horizonEnd,
      upcoming: upcoming.map((item) => ({
        occurrenceId: item.occurrenceId,
        scheduledOn: item.scheduledOn,
        unpaidMinor: formatMinorUnits(item.unpaidMinor),
      })),
      nearestObligations: nearest.map((item) => ({
        occurrenceId: item.occurrenceId,
        name: item.name,
        scheduledOn: item.scheduledOn,
        unpaidMinor: formatMinorUnits(item.unpaidMinor),
      })),
      periodStats,
      envelopes: envelopeList.map(({ envelope, balance }) => ({
        id: envelope.id,
        name: envelope.name,
        envelopeType: envelope.envelopeType,
        periodSlot: envelope.periodSlot,
        balanceMinor: formatMinorUnits(balance),
      })),
      envelopesTotalMinor: formatMinorUnits(
        envelopeList.reduce((sum, { balance }) => sum + balance, 0n),
      ),
      dueMayBeIncomplete,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        balanceMinor: formatMinorUnits(account.balanceMinor),
      })),
      protectedAssignments,
      warnings,
      onboarding: {
        categoriesSeeded: envelopes.length > 0 || (await repo.hasCategories(tx, budgetId)),
        hasAccounts: accounts.length > 0,
        needsOpeningAssignment: cash > 0n && !hasAssignments,
        needsPeriodSetup: needsSetup,
        hasMandatoryPlans: await repo.hasMandatoryPlans(tx, budgetId, mandatoryIds),
        mandatoryPlansDeclined: await repo.mandatoryPlansDeclined(tx, budgetId, workspaceId),
      },
    };
  }
}
