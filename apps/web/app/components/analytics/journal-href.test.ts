import { describe, expect, it } from 'vitest';

import { journalHref } from './journal-href.js';

describe('journalHref', () => {
  it('строит ссылку в журнал из строковых journalFilters', () => {
    expect(journalHref({ journalFilters: { categoryId: 'c', type: 'EXPENSE', skip: 1 } })).toBe(
      '/app/operations?categoryId=c&type=EXPENSE',
    );
  });

  it('без фильтров — журнал целиком', () => {
    expect(journalHref({})).toBe('/app/operations');
  });
});
