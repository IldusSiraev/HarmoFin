// Integer share (0–100) of two server-computed minor-unit strings. A display
// ratio only, never a money value: invalid, empty, non-positive or zero-max
// input gives 0, and anything at or above max is clamped to 100.
export function progressPercent(value: string, max: string): number {
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
  return Number((numerator * 100n) / denominator);
}
