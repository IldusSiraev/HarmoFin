import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = { path: '/app/operations', query: {} as Record<string, string> };
const navigateTo = vi.fn();

vi.mock('#imports', () => ({
  useRoute: () => route,
  navigateTo: (...args: unknown[]) => navigateTo(...args),
}));

import { useOperationFilters } from './useOperationFilters.js';

beforeEach(() => {
  route.query = {};
  navigateTo.mockClear();
});

describe('useOperationFilters', () => {
  it('reads the current query', () => {
    route.query = { accountId: 'account-id', type: 'EXPENSE', from: '2026-09-01' };

    const { filters } = useOperationFilters();

    expect(filters.value.accountId).toBe('account-id');
    expect(filters.value.type).toBe('EXPENSE');
    expect(filters.value.from).toBe('2026-09-01');
  });

  it('starts without filters', () => {
    const { activeCount, toListInput } = useOperationFilters();

    expect(activeCount.value).toBe(0);
    expect(toListInput()).toEqual({});
  });

  it('counts every active filter', () => {
    route.query = { accountId: 'account-id', status: 'DRAFT', to: '2026-09-30' };

    const { activeCount } = useOperationFilters();

    expect(activeCount.value).toBe(3);
  });

  it('drops values from old links that the v2 API would reject', () => {
    route.query = {
      status: 'all',
      type: 'TRANSFER',
      search: 'кафе',
      sortBy: 'amount',
      cycleStart: '2026-09-01',
      periodStart: '2026-09-01',
      planId: 'plan-id',
      accountId: 'account-id',
    };

    const { toListInput, activeCount } = useOperationFilters();

    expect(toListInput()).toEqual({ accountId: 'account-id' });
    expect(activeCount.value).toBe(1);
  });

  it('writes a changed filter into the query', async () => {
    const { set } = useOperationFilters();

    set('envelopeId', 'envelope-id');
    await Promise.resolve();

    expect(navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ envelopeId: 'envelope-id' }) }),
      expect.objectContaining({ replace: true }),
    );
  });

  it('drops empty values from the query', async () => {
    route.query = { accountId: 'account-id' };
    const { set } = useOperationFilters();

    set('accountId', '');
    await Promise.resolve();

    const [target] = navigateTo.mock.calls[0] ?? [];
    expect((target as { query: Record<string, string> }).query).not.toHaveProperty('accountId');
  });

  it('resets everything back to the defaults', async () => {
    route.query = { accountId: 'account-id', type: 'INCOME' };
    const { filters, reset, activeCount } = useOperationFilters();

    reset();
    await Promise.resolve();

    expect(filters.value.accountId).toBe('');
    expect(filters.value.type).toBe('');
    expect(activeCount.value).toBe(0);
  });

  it('builds the list input the v2 API expects', () => {
    route.query = {
      accountId: 'account-id',
      status: 'DRAFT',
      type: 'INCOME',
      from: '2026-09-01',
      to: '2026-09-30',
      categoryId: 'category-id',
      envelopeId: 'envelope-id',
    };

    const { toListInput } = useOperationFilters();

    expect(toListInput()).toEqual({
      accountId: 'account-id',
      status: 'DRAFT',
      type: 'INCOME',
      from: '2026-09-01',
      to: '2026-09-30',
      categoryId: 'category-id',
      envelopeId: 'envelope-id',
    });
  });
});
