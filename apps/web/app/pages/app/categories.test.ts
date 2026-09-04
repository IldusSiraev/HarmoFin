import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  api: { listCategories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), archiveCategory: vi.fn() },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({ useBudgetReferenceData: () => mocks.api }));

import CategoriesPage from './categories.vue';

const income = {
  id: 'income-id', budgetId: 'budget-id', templateKey: null, name: 'Зарплата', categoryType: 'INCOME' as const,
  parentId: null, displayOrder: 0, comment: null, archivedAt: null,
};
const expense = { ...income, id: 'expense-id', name: 'Продукты', categoryType: 'EXPENSE' as const };

function mountPage() {
  return mount(CategoriesPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        CategoryCard: { template: '<article><strong>{{ category.name }}</strong><slot name="actions" /></article>', props: ['category'] },
        UiConfirmDialog: {
          props: ['open'],
          template: '<div v-if="open"><button data-confirm="archive-category" @click="$emit(\'confirm\')">Подтвердить</button></div>',
        },
      },
    },
  });
}

describe('categories page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [{ id: 'workspace-id', name: 'Семья', role: 'OWNER', budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
    };
    mocks.api.listCategories.mockResolvedValue([income, expense]);
  });

  it('renders separate income and expense regions and creates typed category', async () => {
    mocks.api.createCategory.mockResolvedValue(income);
    mocks.api.listCategories.mockResolvedValueOnce([income, expense]).mockResolvedValueOnce([income, expense, { ...income, id: 'new-id', name: 'Подработка' }]);
    const wrapper = mountPage();

    await flushPromises();
    expect(wrapper.text()).toContain('Доходы');
    expect(wrapper.text()).toContain('Расходы');
    await wrapper.get('[data-action="create-category"]').trigger('click');
    await wrapper.get('input[name="name"]').setValue('Подработка');
    await wrapper.get('input[name="displayOrder"]').setValue('2');
    await wrapper.get('form[data-category-form]').trigger('submit');
    await flushPromises();

    expect(mocks.api.createCategory).toHaveBeenCalledWith('budget-id', expect.objectContaining({ categoryType: 'INCOME', displayOrder: 2 }));
  });

  it('requires explicit archive confirmation', async () => {
    mocks.api.archiveCategory.mockResolvedValue({ ...income, archivedAt: '2026-09-04T00:00:00.000Z' });
    const wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="archive-category"]').trigger('click');
    expect(mocks.api.archiveCategory).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-category"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveCategory).toHaveBeenCalledWith('budget-id', 'income-id');
  });
});
