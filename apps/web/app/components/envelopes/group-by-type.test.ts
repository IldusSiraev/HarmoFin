import { describe, expect, it } from 'vitest';

import { groupByType } from './group-by-type.js';
import type { EnvelopeDto, EnvelopeSummaryDto } from '../../composables/useBudgetReferenceData.js';

const envelope = (
  id: string,
  envelopeType: EnvelopeDto['envelopeType'],
  displayOrder: number,
): EnvelopeDto => ({ id, envelopeType, displayOrder }) as unknown as EnvelopeDto;

const summary: EnvelopeSummaryDto = {
  currency: 'RUB',
  scale: 2,
  totalMinor: '810000',
  count: 3,
  byType: [
    { envelopeType: 'CURRENT_EXPENSES', totalMinor: '310000', count: 2 },
    { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
  ],
};

describe('groupByType', () => {
  it('orders groups by domain order, not by arrival', () => {
    const groups = groupByType(
      [
        envelope('a', 'SAVINGS_GOAL', 10),
        envelope('b', 'CURRENT_EXPENSES', 20),
        envelope('c', 'CURRENT_EXPENSES', 10),
      ],
      summary,
    );

    expect(groups.map((group) => group.envelopeType)).toEqual(['CURRENT_EXPENSES', 'SAVINGS_GOAL']);
    expect(groups[0]?.label).toBe('Текущие расходы');
    expect(groups[1]?.label).toBe('Цели накоплений');
  });

  it('keeps display order inside a group', () => {
    const groups = groupByType(
      [envelope('b', 'CURRENT_EXPENSES', 20), envelope('c', 'CURRENT_EXPENSES', 10)],
      summary,
    );

    expect(groups[0]?.items.map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('takes the group total from the server summary', () => {
    const groups = groupByType([envelope('a', 'SAVINGS_GOAL', 10)], summary);

    expect(groups[0]?.totalMinor).toBe('500000');
  });

  it('leaves the total empty when the summary has not arrived', () => {
    const groups = groupByType([envelope('a', 'RESERVE', 10)], null);

    expect(groups[0]?.totalMinor).toBeNull();
    expect(groups[0]?.label).toBe('Резерв');
  });

  it('returns nothing for an empty list', () => {
    expect(groupByType([], summary)).toEqual([]);
  });
});
