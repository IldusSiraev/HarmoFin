import type { Prisma } from '@prisma/client';

import {
  addIsoDays,
  cycleAndPeriodFor,
  type CycleAndPeriod,
  type CycleSettings,
} from './cycle-period.domain.js';
import { CycleRevisionRepository } from './cycle-revision.repository.js';

const revisions = new CycleRevisionRepository();

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Cycle settings in force on `date` (latest BudgetCycleRevision not after it). Falls back to the
 * given Budget settings, so budgets without revisions keep their previous behavior.
 */
export async function settingsInForce(
  tx: Prisma.TransactionClient,
  budgetId: string,
  date: string,
  fallback: CycleSettings,
): Promise<CycleSettings> {
  return (await revisions.settingsAt(tx, budgetId, date)) ?? fallback;
}

/**
 * A confirmed cycle change shortens the old tail at the next revision's start: the period and
 * the cycle containing `date` end on `nextEffectiveOn - 1` when that revision falls inside them.
 */
export function clipAtNextRevision(
  value: CycleAndPeriod,
  date: string,
  nextEffectiveOn: string | null | undefined,
): CycleAndPeriod {
  if (!nextEffectiveOn || nextEffectiveOn <= date) return value;
  const cutoff = addIsoDays(nextEffectiveOn, -1);
  const periodClipped = nextEffectiveOn <= value.period.end;
  const cycleClipped = nextEffectiveOn <= value.cycle.end;
  if (!periodClipped && !cycleClipped) return value;
  return {
    cycle: cycleClipped ? { ...value.cycle, end: cutoff } : value.cycle,
    period: periodClipped ? { ...value.period, end: cutoff } : value.period,
    daysUntilNextBoundary: periodClipped
      ? daysBetween(date, nextEffectiveOn)
      : value.daysUntilNextBoundary,
  };
}

/** Cycle and period containing `date` under the settings in force then, clipped at the next revision. */
export async function cycleAndPeriodAt(
  tx: Prisma.TransactionClient,
  budgetId: string,
  date: string,
  fallback: CycleSettings,
): Promise<CycleAndPeriod> {
  const settings = await settingsInForce(tx, budgetId, date, fallback);
  const next = await revisions.nextEffectiveAfter(tx, budgetId, date);
  return clipAtNextRevision(cycleAndPeriodFor(settings, date), date, next);
}

/** End of the period after the one containing `today`, each period under its own settings. */
export async function nextPeriodEndAt(
  tx: Prisma.TransactionClient,
  budgetId: string,
  today: string,
  fallback: CycleSettings,
): Promise<string> {
  const current = await cycleAndPeriodAt(tx, budgetId, today, fallback);
  const nextStart = addIsoDays(current.period.end, 1);
  return (await cycleAndPeriodAt(tx, budgetId, nextStart, fallback)).period.end;
}
