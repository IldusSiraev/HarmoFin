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
  icon: null,
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

  it('shows the icon picker when creating a category (a new category has no children yet)', async () => {
    mocks.api.createCategory.mockResolvedValue(income);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-category"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('.category-icon-picker')).not.toBeNull();

    const walletButton = Array.from(document.querySelectorAll('.category-icon-picker button')).find(
      (button) => button.getAttribute('aria-label') === 'Кошелёк',
    ) as HTMLButtonElement;
    walletButton.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    nameInput.value = 'Новая категория';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const form = document.querySelector('form[data-category-form]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.api.createCategory).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ parentId: null, icon: 'wallet' }),
    );
  });

  it('shows the icon picker when editing a leaf category with no children', async () => {
    wrapper = mountPage();
    await flushPromises();

    const incomeRow = Array.from(document.querySelectorAll('.category-row')).find((row) =>
      row.textContent?.includes('Зарплата'),
    ) as HTMLElement;
    incomeRow
      .querySelector('[data-action="edit-category"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    expect(document.querySelector('.category-icon-picker')).not.toBeNull();
  });

  it('hides the icon picker when editing a category that has active children', async () => {
    const child = { ...expense, id: 'child-id', name: 'Кафе', parentId: 'expense-id' };
    mocks.api.listCategories.mockResolvedValue([income, expense, child]);
    wrapper = mountPage();
    await flushPromises();

    const parentRow = Array.from(document.querySelectorAll('.category-row')).find((row) =>
      row.textContent?.includes('Продукты'),
    ) as HTMLElement;
    parentRow
      .querySelector('[data-action="edit-category"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    expect(document.querySelector('.category-icon-picker')).toBeNull();
  });

  type MockedWorkspaces = { workspaces: Array<{ role: string }> };

  it('hides category management for a viewer', async () => {
    (mocks.auth.currentData.value as MockedWorkspaces).workspaces[0]!.role = 'VIEWER';
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-action="create-category"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="edit-category"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="archive-category"]').exists()).toBe(false);
  });

  it('hides category management for an editor too: only the owner manages categories', async () => {
    (mocks.auth.currentData.value as MockedWorkspaces).workspaces[0]!.role = 'EDITOR';
    wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-action="create-category"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="edit-category"]').exists()).toBe(false);
  });
});
