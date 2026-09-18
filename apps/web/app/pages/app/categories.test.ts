import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  api: {
    listCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    archiveCategory: vi.fn(),
  },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import CategoriesPage from './categories.vue';

const income = {
  id: 'income-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Зарплата',
  categoryType: 'INCOME' as const,
  parentId: null,
  displayOrder: 0,
  comment: null,
  archivedAt: null,
};
const expense = { ...income, id: 'expense-id', name: 'Продукты', categoryType: 'EXPENSE' as const };

function mountPage() {
  return mount(CategoriesPage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        CategoryCard: {
          template:
            '<article><strong>{{ category.name }}</strong><slot name="actions" /></article>',
          props: ['category'],
        },
        UiConfirmDialog: {
          props: ['open'],
          template:
            '<div v-if="open"><button data-confirm="archive-category" @click="$emit(\'confirm\')">Подтвердить</button></div>',
        },
      },
    },
  });
}

describe('categories page', () => {
  let wrapper: ReturnType<typeof mountPage> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }],
        },
      ],
    };
    mocks.api.listCategories.mockResolvedValue([income, expense]);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it('renders separate income and expense regions and creates typed category', async () => {
    mocks.api.createCategory.mockResolvedValue(income);
    mocks.api.listCategories
      .mockResolvedValueOnce([income, expense])
      .mockResolvedValueOnce([income, expense, { ...income, id: 'new-id', name: 'Подработка' }]);
    wrapper = mountPage();

    await flushPromises();
    expect(wrapper.text()).toContain('Доходы');
    expect(wrapper.text()).toContain('Расходы');
    await wrapper.get('[data-action="create-category"]').trigger('click');
    await flushPromises();

    // Form is Teleported to body, access via document
    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    const displayOrderInput = document.querySelector(
      'input[name="displayOrder"]',
    ) as HTMLInputElement;
    const form = document.querySelector('form[data-category-form]') as HTMLFormElement;

    nameInput.value = 'Подработка';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    displayOrderInput.value = '2';
    displayOrderInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.api.createCategory).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ categoryType: 'INCOME', displayOrder: 2 }),
    );
  });

  it('nests a child category under its parent as an indented row in the same column', async () => {
    const child = {
      ...expense,
      id: 'child-id',
      name: 'Кафе',
      parentId: 'expense-id',
    };
    mocks.api.listCategories.mockResolvedValue([income, expense, child]);
    wrapper = mountPage();
    await flushPromises();

    const rows = document.querySelectorAll('.category-row');
    const parentRow = Array.from(rows).find((row) => row.textContent?.includes('Продукты'));
    const childRow = Array.from(rows).find((row) => row.textContent?.includes('Кафе'));

    expect(parentRow?.classList.contains('category-row--child')).toBe(false);
    expect(childRow?.classList.contains('category-row--child')).toBe(true);
    // The child renders right after its parent, inside the same "Расходы" list.
    expect(Array.from(rows).indexOf(childRow!)).toBe(Array.from(rows).indexOf(parentRow!) + 1);
  });

  it('requires explicit archive confirmation', async () => {
    mocks.api.archiveCategory.mockResolvedValue({
      ...income,
      archivedAt: '2026-09-04T00:00:00.000Z',
    });
    wrapper = mountPage();

    await flushPromises();
    await wrapper.get('[data-action="archive-category"]').trigger('click');
    expect(mocks.api.archiveCategory).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-category"]').trigger('click');
    await flushPromises();
    expect(mocks.api.archiveCategory).toHaveBeenCalledWith('budget-id', 'income-id');
  });
});
