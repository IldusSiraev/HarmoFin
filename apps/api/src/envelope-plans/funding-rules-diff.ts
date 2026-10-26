export type RuleShape = {
  envelopeId: string;
  type: string;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

const key = (rule: RuleShape): string =>
  [rule.type, rule.priority, rule.fixedMinor?.toString() ?? '', rule.percentBasisPoints ?? ''].join(
    '|',
  );

/**
 * Envelopes whose funding rule a batch creates or changes. The batch never deletes a rule of an
 * envelope absent from `desired` (it keeps the envelope's existing rule untouched), so an absent
 * envelope is not reported here either.
 */
export function changedRuleEnvelopeIds(existing: RuleShape[], desired: RuleShape[]): string[] {
  const before = new Map(existing.map((rule) => [rule.envelopeId, key(rule)]));
  const ids = new Set<string>();
  for (const rule of desired) {
    if (before.get(rule.envelopeId) !== key(rule)) ids.add(rule.envelopeId);
  }
  return [...ids];
}
