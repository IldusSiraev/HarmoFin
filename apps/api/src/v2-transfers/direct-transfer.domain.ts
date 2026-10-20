/** Effect of one transfer state on account balances: only CONFIRMED moves money. */
export type TransferEffect = {
  confirmed: boolean;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
};

function effects(state: TransferEffect): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (!state.confirmed) return result;
  result.set(state.sourceAccountId, -state.amountMinor);
  result.set(
    state.destinationAccountId,
    (result.get(state.destinationAccountId) ?? 0n) + state.amountMinor,
  );
  return result;
}

/**
 * Accounts whose balance goes down when a transfer moves from `before` to `after`,
 * with the positive size of the decrease. Only these need the non-negative check.
 */
export function balanceDecreases(
  before: TransferEffect,
  after: TransferEffect,
): Map<string, bigint> {
  const was = effects(before);
  const will = effects(after);
  const decreases = new Map<string, bigint>();
  for (const accountId of new Set([...was.keys(), ...will.keys()])) {
    const delta = (will.get(accountId) ?? 0n) - (was.get(accountId) ?? 0n);
    if (delta < 0n) decreases.set(accountId, -delta);
  }
  return decreases;
}
