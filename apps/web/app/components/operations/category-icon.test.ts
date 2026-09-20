import { ArrowDownLeft, ArrowUpRight, Banknote, ShoppingCart } from '@lucide/vue';
import { describe, expect, it } from 'vitest';

import { CATEGORY_ICON_OPTIONS, categoryIcon } from './category-icon.js';

describe('categoryIcon', () => {
  it('maps a known icon key', () => {
    expect(categoryIcon('shopping-cart', 'EXPENSE')).toBe(ShoppingCart);
    expect(categoryIcon('banknote', 'INCOME')).toBe(Banknote);
  });

  it('falls back to the operation type when icon is null', () => {
    expect(categoryIcon(null, 'INCOME')).toBe(ArrowDownLeft);
    expect(categoryIcon(null, 'EXPENSE')).toBe(ArrowUpRight);
  });

  it('falls back for an unknown icon key', () => {
    expect(categoryIcon('not-a-real-icon', 'EXPENSE')).toBe(ArrowUpRight);
  });
});

describe('CATEGORY_ICON_OPTIONS', () => {
  it('has a unique, non-empty key and label for every option', () => {
    expect(CATEGORY_ICON_OPTIONS.length).toBeGreaterThan(0);
    const keys = CATEGORY_ICON_OPTIONS.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of CATEGORY_ICON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
