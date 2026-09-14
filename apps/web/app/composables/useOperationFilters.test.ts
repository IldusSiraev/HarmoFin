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
    route.query = { accountId: 'account-id', type: 'EXPENSE', search: 'кафе' };

    const { filters } = useOperationFilters();

    expect(filters.value.accountId).toBe('account-id');
    expect(filters.value.type).toBe('EXPENSE');
    expect(filters.value.search).toBe('кафе');
  });

  it('defaults to newest first without filters', () => {
    const { filters, activeCount, isGrouped } = useOperationFilters();

    expect(filters.value.sortBy).toBe('occurredOn');
    expect(filters.value.sortDirection).toBe('desc');
    expect(activeCount.value).toBe(0);
    expect(isGrouped.value).toBe(true);
  });

  it('counts active filters without counting sorting', () => {
    route.query = { accountId: 'account-id', status: 'DRAFT', sortBy: 'amount' };

    const { activeCount, isGrouped } = useOperationFilters();

    expect(activeCount.value).toBe(2);
    expect(isGrouped.value).toBe(false);
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
    route.query = { accountId: 'account-id', type: 'INCOME', sortBy: 'amount' };
    const { filters, reset, activeCount } = useOperationFilters();

    reset();
    await Promise.resolve();

    expect(filters.value.accountId).toBe('');
    expect(filters.value.type).toBe('');
    expect(filters.value.sortBy).toBe('occurredOn');
    expect(activeCount.value).toBe(0);
  });

  it('builds the list input the API expects', () => {
    route.query = { accountId: 'account-id', search: 'кафе', status: 'DRAFT' };

    const { toListInput } = useOperationFilters();

    expect(toListInput()).toEqual({
      accountId: 'account-id',
      search: 'кафе',
      status: 'DRAFT',
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
  });
});
