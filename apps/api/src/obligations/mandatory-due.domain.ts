/**
 * Недостаток денег под обязательные платежи: потребность минус неотрицательный баланс
 * конверта «Обязательные». Отрицательный баланс не увеличивает нехватку сверх потребности.
 */
export function mandatoryFundingGap(due: bigint, balance: bigint): bigint {
  const covered = balance > 0n ? balance : 0n;
  const gap = due - covered;
  return gap > 0n ? gap : 0n;
}
