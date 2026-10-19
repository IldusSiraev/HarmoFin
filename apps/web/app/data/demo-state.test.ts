import { describe, expect, it } from 'vitest';

import { parseDemoQuery, toDemoQuery } from './demo-state.js';

describe('demo state', () => {
  it('uses defaults for an empty query', () => {
    expect(parseDemoQuery({})).toEqual({
      step: 0,
      start: 10,
      offset: 15,
      split: null,
      leftover: null,
    });
  });

  it('replaces invalid values with defaults', () => {
    expect(
      parseDemoQuery({ step: '99', start: '0', offset: 'x', split: 'all', leftover: 'burn' }),
    ).toEqual({
      step: 0,
      start: 10,
      offset: 15,
      split: null,
      leftover: null,
    });
  });

  it('rewinds to the step whose choice is missing', () => {
    expect(parseDemoQuery({ step: '4' }).step).toBe(2);
    expect(parseDemoQuery({ step: '6', split: 'vacation' }).step).toBe(5);
    expect(parseDemoQuery({ step: '6', split: 'vacation', leftover: 'save' }).step).toBe(6);
  });

  it('drops a leftover choice made without a split', () => {
    expect(parseDemoQuery({ step: '1', leftover: 'save' }).leftover).toBeNull();
  });

  it('round-trips through the query', () => {
    const state = {
      step: 6,
      start: 5,
      offset: 10,
      split: 'suggested' as const,
      leftover: 'carry' as const,
    };
    expect(parseDemoQuery(toDemoQuery(state))).toEqual(state);
    expect(toDemoQuery({ step: 1, start: 10, offset: 15, split: null, leftover: null })).toEqual({
      step: '1',
      start: '10',
      offset: '15',
    });
  });
});
