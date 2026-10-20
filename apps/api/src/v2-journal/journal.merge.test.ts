import { describe, expect, it } from 'vitest';

import { comparePositions, mergeNewestFirst, type FeedPosition } from './journal.merge.js';

const p = (occurredOn: string, createdAt: string, id: string): FeedPosition => ({
  occurredOn, createdAt, id,
});

describe('journal merge', () => {
  it('новые раньше: дата, затем время создания, затем id', () => {
    expect(comparePositions(p('2026-10-20', 'a', '1'), p('2026-10-19', 'z', '9'))).toBeLessThan(0);
    expect(comparePositions(p('2026-10-20', '2026-10-20T10:00:00.000Z', '1'),
      p('2026-10-20', '2026-10-20T09:00:00.000Z', '9'))).toBeLessThan(0);
    expect(comparePositions(p('2026-10-20', 't', 'b'), p('2026-10-20', 't', 'a'))).toBeLessThan(0);
  });

  it('сливает два отсортированных списка и обрезает до limit', () => {
    const left = [p('2026-10-20', 't', 'c'), p('2026-10-18', 't', 'a')];
    const right = [p('2026-10-19', 't', 'b'), p('2026-10-17', 't', 'd')];
    expect(mergeNewestFirst(left, right, (x) => x, 3).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});
