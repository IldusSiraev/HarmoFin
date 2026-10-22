import type { EnvelopeType } from '@prisma/client';

export type ObligationCoverage = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

export type EnvelopeProgress = {
  kind: 'SPENT' | 'COVERED' | 'GOAL';
  valueMinor: bigint;
  maxMinor: bigint;
  shortfallMinor: bigint | null;
};

const positive = (value: bigint) => (value > 0n ? value : 0n);
const GOAL_TYPES = new Set<EnvelopeType>(['SAVINGS_GOAL', 'RESERVE', 'CUSTOM']);

/**
 * Greedy coverage of open mandatory payments, in the given (due date, id) order, from the positive
 * balance of each payment's own envelope. Exact for a date-ordered prefix of the open list.
 */
export function obligationCoverage(
  items: ReadonlyArray<{ envelopeId: string; unpaidMinor: bigint }>,
  balanceByEnvelope: ReadonlyMap<string, bigint>,
): Array<{ coverage: ObligationCoverage; shortfallMinor: bigint }> {
  const remaining = new Map<string, bigint>();
  return items.map((item) => {
    const left =
      remaining.get(item.envelopeId) ?? positive(balanceByEnvelope.get(item.envelopeId) ?? 0n);
    const covered = left < item.unpaidMinor ? left : item.unpaidMinor;
    remaining.set(item.envelopeId, left - covered);
    const shortfall = item.unpaidMinor - covered;
    const coverage: ObligationCoverage =
      shortfall === 0n ? 'COVERED' : covered === 0n ? 'UNCOVERED' : 'PARTIAL';
    return { coverage, shortfallMinor: shortfall };
  });
}

/** Display progress of one dashboard envelope; both ends are server sums, never a client total. */
export function envelopeProgress(input: {
  envelopeType: EnvelopeType;
  balance: bigint;
  targetAmountMinor: bigint | null;
  isMainPeriodEnvelope: boolean;
  mainPeriod: { spent: bigint; available: bigint } | null;
  mandatoryDue: bigint;
}): EnvelopeProgress | null {
  if (input.envelopeType === 'CURRENT_EXPENSES') {
    if (!input.isMainPeriodEnvelope || !input.mainPeriod || input.mainPeriod.available <= 0n) {
      return null;
    }
    return {
      kind: 'SPENT',
      valueMinor: input.mainPeriod.spent,
      maxMinor: input.mainPeriod.available,
      shortfallMinor: null,
    };
  }
  if (input.envelopeType === 'MANDATORY_EXPENSES') {
    if (input.mandatoryDue <= 0n) return null;
    const held = positive(input.balance);
    return {
      kind: 'COVERED',
      valueMinor: held,
      maxMinor: input.mandatoryDue,
      shortfallMinor: positive(input.mandatoryDue - held),
    };
  }
  if (!GOAL_TYPES.has(input.envelopeType)) return null;
  if (input.targetAmountMinor === null || input.targetAmountMinor <= 0n) return null;
  return {
    kind: 'GOAL',
    valueMinor: positive(input.balance),
    maxMinor: input.targetAmountMinor,
    shortfallMinor: null,
  };
}
