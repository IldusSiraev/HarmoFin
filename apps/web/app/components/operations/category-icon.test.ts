import { ArrowDownLeft, ArrowUpRight, Banknote, ShoppingCart } from '@lucide/vue';
import { describe, expect, it } from 'vitest';

import { categoryIcon } from './category-icon.js';

describe('categoryIcon', () => {
  it('maps a known template key', () => {
    expect(categoryIcon('expense-groceries', 'EXPENSE')).toBe(ShoppingCart);
    expect(categoryIcon('income-salary', 'INCOME')).toBe(Banknote);
  });

  it('falls back to the operation type for a custom category', () => {
    expect(categoryIcon(null, 'INCOME')).toBe(ArrowDownLeft);
    expect(categoryIcon(null, 'EXPENSE')).toBe(ArrowUpRight);
  });

  it('falls back for an unknown template key', () => {
    expect(categoryIcon('expense-unheard-of', 'EXPENSE')).toBe(ArrowUpRight);
  });
});
