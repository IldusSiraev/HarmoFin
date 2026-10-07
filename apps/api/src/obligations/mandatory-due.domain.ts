/**
 * Недостаток денег под обязательные платежи: потребность минус неотрицательный баланс
 * конверта «Обязательные». Отрицательный баланс не увеличивает нехватку сверх потребности.
 */
export function mandatoryFundingGap(due: bigint, balance: bigint): bigint {
  const covered = balance > 0n ? balance : 0n;
  const gap = due - covered;
  return gap > 0n ? gap : 0n;
}

export type MandatorySlice = 'MANDATORY_CURRENT' | 'MANDATORY_NEXT';

/** Ключ строки обязательного слайса в финансировании: канон `envelopeId||slice` (средний компонент пуст). */
export function mandatoryLineId(envelopeId: string, slice: MandatorySlice): string {
  return `${envelopeId}||${slice}`;
}

export type MandatorySliceGaps = {
  /** Недостаток, приходящийся на слайс текущего периода (включая просроченные). */
  currentGapMinor: bigint;
  /** Недостаток, приходящийся на слайс следующего периода. */
  nextGapMinor: bigint;
  /** Общий недостаток: `mandatoryFundingGap(dueCurrent + dueNext, balance)`. */
  totalGapMinor: bigint;
};

/**
 * Расщепление потребности и нехватки на два слайса (текущий/следующий период). Баланс
 * «Обязательные» сначала гасит текущий слайс (вместе с просрочкой); остаток нехватки падает
 * на следующий. Инвариант: currentGap + nextGap === totalGap === mandatoryFundingGap(сумма, баланс).
 */
export function mandatorySliceGaps(
  dueCurrentMinor: bigint,
  dueNextMinor: bigint,
  balanceMinor: bigint,
): MandatorySliceGaps {
  const dueCurrent = dueCurrentMinor > 0n ? dueCurrentMinor : 0n;
  const dueNext = dueNextMinor > 0n ? dueNextMinor : 0n;
  const totalGap = mandatoryFundingGap(dueCurrent + dueNext, balanceMinor);
  const covered = balanceMinor > 0n ? balanceMinor : 0n;
  const currentGap = dueCurrent - covered > 0n ? dueCurrent - covered : 0n;
  const nextGap = totalGap - currentGap;
  return { currentGapMinor: currentGap, nextGapMinor: nextGap, totalGapMinor: totalGap };
}
