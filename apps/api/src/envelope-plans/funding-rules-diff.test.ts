import { describe, expect, it } from 'vitest';

import { changedRuleEnvelopeIds, type RuleShape } from './funding-rules-diff.js';

const rule = (envelopeId: string, priority = 1): RuleShape => ({
  envelopeId,
  type: 'FIXED_PER_PERIOD',
  priority,
  fixedMinor: 1000n,
  percentBasisPoints: null,
});

describe('changedRuleEnvelopeIds', () => {
  it('ignores unchanged rules', () => {
    expect(changedRuleEnvelopeIds([rule('a'), rule('b')], [rule('a'), rule('b')])).toEqual([]);
  });

  it('reports created and changed rules, not rules absent from desired', () => {
    expect(
      changedRuleEnvelopeIds([rule('a'), rule('b')], [rule('a', 2), rule('c')]).sort(),
    ).toEqual(['a', 'c']);
  });
});
