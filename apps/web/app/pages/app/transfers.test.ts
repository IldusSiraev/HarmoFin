import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: {
      value: {
        workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
      } as {
        workspaces: Array<{
          budgets: Array<{ id: string; name: string; primaryCurrency: string }>;
        }>;
      } | null,
    },
    loadMe: vi.fn(),
  },
  api: {
    listAccounts: vi.fn(),
    listEnvelopes: vi.fn(),
    listTransfers: vi.fn(),
    createTransfer: vi.fn(),
    confirmTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
  },
}));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  useRoute: () => ({ query: { sourceAccountId: 'source-account' } }),
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => mocks.api,
}));

import TransfersPage from './transfers.vue';

describe('transfers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.listAccounts.mockResolvedValue([
      { id: 'source-account', name: 'Основной счёт', archivedAt: null },
      { id: 'destination-account', name: 'Накопительный счёт', archivedAt: null },
    ]);
    mocks.api.listEnvelopes.mockResolvedValue([{ id: 'repair', name: 'Ремонт', archivedAt: null }]);
    mocks.api.listTransfers.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('loads server references before applying source-account prefill', async () => {
    const wrapper = mount(TransfersPage, {
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' }, UiConfirmDialog: true } },
    });
    await flushPromises();

    await wrapper.get('[data-action="create-transfer"]').trigger('click');
    expect((wrapper.get('select[name="sourceAccountId"]').element as HTMLSelectElement).value).toBe(
      'source-account',
    );
  });
});
