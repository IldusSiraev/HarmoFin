import { describe, expect, it } from 'vitest';

import { groupByDay } from './group-by-day.js';
import type { TransactionDto } from '../../composables/useBudgetReferenceData.js';

const at = (id: string, occurredOn: string): TransactionDto =>
  ({ id, occurredOn }) as unknown as TransactionDto;

describe('groupByDay', () => {
  it('names today and yesterday, then plain dates', () => {
    const groups = groupByDay(
      [at('a', '2026-09-14'), at('b', '2026-09-13'), at('c', '2026-09-12')],
      '2026-09-14',
    );

    expect(groups.map((group) => group.label)).toEqual([
      'Сегодня, 14 сентября',
      'Вчера, 13 сентября',
      '12 сентября',
    ]);
  });

  it('keeps operations of one day together in their original order', () => {
    const groups = groupByDay(
      [at('a', '2026-09-14'), at('b', '2026-09-14'), at('c', '2026-09-13')],
      '2026-09-14',
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['c']);
  });

  it('handles a month boundary for yesterday', () => {
    expect(groupByDay([at('a', '2026-08-31')], '2026-09-01')[0]?.label).toBe('Вчера, 31 августа');
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], '2026-09-14')).toEqual([]);
  });
});
