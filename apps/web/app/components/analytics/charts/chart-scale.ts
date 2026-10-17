/**
 * Geometry only: share of two server sums as 0..100 with 0.01 precision. Money stays in bigint;
 * the result never becomes a displayed amount.
 */
export function ratioPercent(value: string, max: string): number {
  let numerator: bigint;
  let denominator: bigint;
  try {
    numerator = BigInt(value);
    denominator = BigInt(max);
  } catch {
    return 0;
  }
  if (denominator <= 0n || numerator <= 0n) return 0;
  if (numerator >= denominator) return 100;
  return Number((numerator * 10_000n) / denominator) / 100;
}

/** Server basis points (0..10000) as a short Russian percent label. */
export function basisPointsPercent(basisPoints: number): string {
  if (basisPoints <= 0) return '0%';
  if (basisPoints < 10) return '<0,1%';
  if (basisPoints < 100) return `0,${Math.trunc(basisPoints / 10)}%`;
  return `${Math.trunc(basisPoints / 100)}%`;
}
