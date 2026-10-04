import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryDto } from '../../composables/useBudgetReferenceData.js';
import PlanCreateDialog from './PlanCreateDialog.vue';

function category(
  id: string,
  name: string,
  type: 'EXPENSE' | 'INCOME',
  archivedAt: string | null = null,
): CategoryDto {
  return {
    id,
    budgetId: 'b',
    templateKey: null,
    name,
    categoryType: type,
    parentId: null,
    displayOrder: 0,
    comment: null,
    icon: null,
    archivedAt,
  };
}

const categories = [
  category('c-rent', 'Аренда', 'EXPENSE'),
  category('c-food', 'Еда', 'EXPENSE'),
  category('c-old', 'Старое', 'EXPENSE', '2026-01-01'),
  category('c-salary', 'Зарплата', 'INCOME'),
];

const wrappers: Array<{ unmount: () => void }> = [];
function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(PlanCreateDialog, {
    props: { open: true, categories, pending: false, error: null, fieldErrors: {}, ...props },
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
type Wrapper = ReturnType<typeof mountDialog>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T09:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

async function fill(wrapper: Wrapper, amount = '45000', name = 'Аренда', pill = 'c-rent') {
  await wrapper.get('#operation-amount-input').setValue(amount);
  await wrapper.get('#planName-input').setValue(name);
  await wrapper.get(`[data-testid="pill-planCategory-${pill}"]`).trigger('click');
}
const submitButton = (wrapper: Wrapper) => wrapper.get('[data-testid="plan-submit"]');
const tab = (wrapper: Wrapper, kind: string) => wrapper.get(`[data-testid="plan-tab-${kind}"]`);

describe('PlanCreateDialog', () => {
  it('renders tabs with aria-selected and honours initialKind', () => {
    const wrapper = mountDialog();
    expect(tab(wrapper, 'obligation').attributes('role')).toBe('tab');
    expect(tab(wrapper, 'obligation').attributes('aria-selected')).toBe('true');
    expect(tab(wrapper, 'income').attributes('aria-selected')).toBe('false');
    expect(tab(wrapper, 'obligation').text()).toBe('Платёж');
    expect(tab(wrapper, 'income').text()).toBe('Доход');

    const income = mountDialog({ initialKind: 'income' });
    expect(tab(income, 'income').attributes('aria-selected')).toBe('true');
  });

  it('labels the date and button per tab', async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain('Ближайший платёж');
    expect(submitButton(wrapper).text()).toContain('Добавить платёж');
    await tab(wrapper, 'income').trigger('click');
    expect(wrapper.text()).toContain('Первое поступление');
    expect(submitButton(wrapper).text()).toContain('Добавить доход');
  });

  it('shows the per-tab hint', async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain(
      'План ничего не списывает. Когда придёт срок, нажмите «Оплатить» и выберите счёт.',
    );
    await tab(wrapper, 'income').trigger('click');
    expect(wrapper.text()).toContain(
      'План ничего не добавляет на счёт. Когда деньги придут, нажмите «Записать доход».',
    );
  });

  it('filters categories by type, hides archived, and resets category on tab switch', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('[data-testid="pill-planCategory-c-rent"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pill-planCategory-c-old"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pill-planCategory-c-salary"]').exists()).toBe(false);

    await fill(wrapper);
    await tab(wrapper, 'income').trigger('click');
    expect(wrapper.find('[data-testid="pill-planCategory-c-salary"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pill-planCategory-c-rent"]').exists()).toBe(false);
    // Category cleared, other fields kept.
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined();
    expect((wrapper.get('#planName-input').element as HTMLInputElement).value).toBe('Аренда');
    expect((wrapper.get('#operation-amount-input').element as HTMLInputElement).value).toBe(
      '45000',
    );
  });

  it('searches categories by name', async () => {
    const wrapper = mountDialog();
    await wrapper.get('#planCategorySearch-input').setValue('еда');
    expect(wrapper.find('[data-testid="pill-planCategory-c-food"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pill-planCategory-c-rent"]').exists()).toBe(false);
  });

  it('shows a template hint and disables submit when no category of the type exists', () => {
    const wrapper = mountDialog({ categories: [category('c-salary', 'Зарплата', 'INCOME')] });
    expect(wrapper.text()).toContain('Нет категорий расходов');
    expect(wrapper.find('a[href="/app"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="pill-planCategory-c-salary"]').exists()).toBe(false);
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('toggles interval and end date by recurrence', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('#planIntervalMonths-input').exists()).toBe(false);
    expect(wrapper.find('#planEndOn-input').exists()).toBe(true);

    await wrapper.get('[data-testid="pill-planRecurrence-EVERY_N_MONTHS"]').trigger('click');
    expect(wrapper.find('#planIntervalMonths-input').exists()).toBe(true);

    await wrapper.get('[data-testid="pill-planRecurrence-ONE_TIME"]').trigger('click');
    expect(wrapper.find('#planIntervalMonths-input').exists()).toBe(false);
    expect(wrapper.find('#planEndOn-input').exists()).toBe(false);
  });

  it('disables submit until amount, name and category are set and while pending', async () => {
    const wrapper = mountDialog();
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined();
    await fill(wrapper);
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined();

    await wrapper.setProps({ pending: true });
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined();
    expect(submitButton(wrapper).attributes('aria-busy')).toBe('true');
  });

  it('emits kind and request on submit', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="pill-planRecurrence-ONE_TIME"]').trigger('click');
    await fill(wrapper, '45000,5', ' Аренда ');
    await submitButton(wrapper).trigger('click');

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          kind: 'obligation',
          request: {
            name: 'Аренда',
            amount: '45000.5',
            scheduledOn: '2026-10-04',
            categoryId: 'c-rent',
            recurrence: 'ONE_TIME',
          },
        },
      ],
    ]);
  });

  it('emits income kind from the income tab', async () => {
    const wrapper = mountDialog({ initialKind: 'income' });
    await fill(wrapper, '100', 'Зарплата', 'c-salary');
    await submitButton(wrapper).trigger('click');
    expect((wrapper.emitted('submit')?.[0]?.[0] as { kind: string }).kind).toBe('income');
  });

  it('blocks submit on local errors and focuses the first invalid field', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[data-testid="pill-planRecurrence-EVERY_N_MONTHS"]').trigger('click');
    await fill(wrapper, '0');
    await wrapper.get('#planIntervalMonths-input').setValue('1');
    await submitButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('Введите сумму больше нуля');
    expect(wrapper.text()).toContain('Укажите интервал от 2 до 120 месяцев');
    expect(document.activeElement?.id).toBe('operation-amount-input');
  });

  it('shows server field errors and a general alert, keeping input', async () => {
    const wrapper = mountDialog({
      error: 'Не удалось сохранить план. Попробуйте ещё раз.',
      fieldErrors: { name: 'Название занято' },
    });
    await fill(wrapper);
    expect(wrapper.text()).toContain('Название занято');
    const alerts = wrapper.findAll('[role="alert"]').map((node) => node.text());
    expect(alerts).toContain('Не удалось сохранить план. Попробуйте ещё раз.');
    expect((wrapper.get('#planName-input').element as HTMLInputElement).value).toBe('Аренда');
  });

  it('resets the form and defaults on each open', async () => {
    const wrapper = mountDialog({ open: false, initialDate: '2026-11-15' });
    await wrapper.setProps({ open: true });
    expect((wrapper.get('#planScheduledOn-input').element as HTMLInputElement).value).toBe(
      '15.11.2026',
    );
    expect(
      wrapper.get('[data-testid="pill-planRecurrence-MONTHLY"]').attributes('aria-checked'),
    ).toBe('true');

    await fill(wrapper);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect((wrapper.get('#planName-input').element as HTMLInputElement).value).toBe('');
  });

  it('defaults the date to today', async () => {
    const wrapper = mountDialog();
    await flushPromises();
    expect((wrapper.get('#planScheduledOn-input').element as HTMLInputElement).value).toBe(
      '04.10.2026',
    );
  });

  it('is accessible: labelled fields, close button, Esc closes', async () => {
    const wrapper = mountDialog();
    for (const id of ['planName-input', 'planScheduledOn-input', 'planComment-input']) {
      expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true);
    }
    expect(wrapper.find('label[for="operation-amount-input"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Закрыть"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Увеличить сумму"]').exists()).toBe(false);

    await wrapper.get('[aria-label="Закрыть"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')?.length).toBe(2);
  });
});
