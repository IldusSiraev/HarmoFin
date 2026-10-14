import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import UiDatePicker from '../ui/DatePicker.vue';
import ObligationPaySheet from './ObligationPaySheet.vue';

const norm = (value: string): string => value.replace(/\s/g, ' ');

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    occurrence: {
      id: 'occ-1',
      name: 'Детский сад',
      scheduledOn: '2026-09-10',
      expectedMinor: '300000',
      categoryId: 'cat-1',
    },
    categoryName: 'Детский сад (категория)',
    accounts: [
      { value: 'acc-1', label: 'Карта' },
      { value: 'acc-2', label: 'Наличные' },
    ],
    today: '2026-09-24',
    pending: false,
    error: null,
    fieldErrors: {},
    ...overrides,
  };
}

const wrappers: Array<{ unmount: () => void }> = [];
function mountSheet(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(ObligationPaySheet, {
    props: baseProps(overrides),
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

type Wrapper = ReturnType<typeof mountSheet>;

async function typeAmount(wrapper: Wrapper, value: string) {
  await wrapper.get('[data-testid="pay-amount"]').setValue(value);
}
async function pickAccount(wrapper: Wrapper, id = 'acc-1') {
  await wrapper.get(`[data-testid="pill-accountId-${id}"]`).trigger('click');
}
function submits(wrapper: Wrapper) {
  return wrapper.emitted('submit') ?? [];
}

describe('ObligationPaySheet', () => {
  it('prefills date, expected amount, category and the read-only mandatory envelope', () => {
    const wrapper = mountSheet();
    const text = norm(wrapper.text());

    expect(text).toContain('Детский сад (категория)');
    expect(text).toContain('Обязательные');
    expect(text).toContain('3 000,00');
    expect((wrapper.get('[data-testid="pay-amount"]').element as HTMLInputElement).value).toBe(
      '3000.00',
    );
    expect(wrapper.find('[data-testid="pay-submit"]').exists()).toBe(true);
  });

  it('submits the typed actual amount as a decimal string with willPayMore false', async () => {
    const wrapper = mountSheet();
    await typeAmount(wrapper, '2000.00');
    await pickAccount(wrapper);
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');

    expect(submits(wrapper)).toHaveLength(1);
    expect(submits(wrapper)[0]?.[0]).toEqual(
      expect.objectContaining({
        amount: '2000.00',
        willPayMore: false,
        accountId: 'acc-1',
        categoryId: 'cat-1',
        occurredOn: '2026-09-24',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('shows the partial-payment switch only when the typed amount is below the expected one', async () => {
    const wrapper = mountSheet();
    expect(wrapper.find('[data-testid="pay-will-pay-more"]').exists()).toBe(false);

    await typeAmount(wrapper, '2000,5');
    expect(wrapper.find('[data-testid="pay-will-pay-more"]').exists()).toBe(true);

    await typeAmount(wrapper, '3000.00');
    expect(wrapper.find('[data-testid="pay-will-pay-more"]').exists()).toBe(false);

    await typeAmount(wrapper, '4000');
    expect(wrapper.find('[data-testid="pay-will-pay-more"]').exists()).toBe(false);
  });

  it('sends willPayMore true for a partial payment and false once the switch is hidden again', async () => {
    const wrapper = mountSheet({
      occurrence: {
        id: 'occ-2',
        name: 'Аренда',
        scheduledOn: '2026-09-10',
        expectedMinor: '4000000',
        categoryId: 'cat-1',
      },
    });
    await typeAmount(wrapper, '35000.00');
    await pickAccount(wrapper);
    await wrapper.get('[data-testid="pay-will-pay-more"]').setValue(true);
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');

    expect(submits(wrapper)[0]?.[0]).toEqual(
      expect.objectContaining({ amount: '35000.00', willPayMore: true }),
    );

    const other = mountSheet();
    await typeAmount(other, '1000.00');
    await other.get('[data-testid="pay-will-pay-more"]').setValue(true);
    await typeAmount(other, '3000.00');
    await pickAccount(other);
    await other.get('[data-testid="pay-submit"]').trigger('click');
    expect(submits(other)[0]?.[0]).toEqual(expect.objectContaining({ willPayMore: false }));
  });

  it('requires a real account and a valid amount before emitting', async () => {
    const wrapper = mountSheet();
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    expect(submits(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain('Выберите счёт');

    await typeAmount(wrapper, '0');
    await pickAccount(wrapper);
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    expect(submits(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain('Введите сумму больше нуля');
  });

  it('emits once on a double click and keeps the same key when the attempt is retried', async () => {
    const wrapper = mountSheet();
    await pickAccount(wrapper);
    const button = wrapper.get('[data-testid="pay-submit"]');
    await button.trigger('click');
    await button.trigger('click');
    expect(submits(wrapper)).toHaveLength(1);
    const firstKey = (submits(wrapper)[0]?.[0] as { idempotencyKey: string }).idempotencyKey;

    // Parent starts the request, it fails, the user retries unchanged.
    await wrapper.setProps({ pending: true });
    await wrapper.setProps({ pending: false, error: 'Не удалось' });
    await button.trigger('click');
    expect(submits(wrapper)).toHaveLength(2);
    expect((submits(wrapper)[1]?.[0] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);
  });

  it('uses a new key after any field change', async () => {
    const wrapper = mountSheet();
    await pickAccount(wrapper);
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    const firstKey = (submits(wrapper)[0]?.[0] as { idempotencyKey: string }).idempotencyKey;

    await wrapper.setProps({ pending: true });
    await wrapper.setProps({ pending: false });
    await typeAmount(wrapper, '2500.00');
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    expect((submits(wrapper)[1]?.[0] as { idempotencyKey: string }).idempotencyKey).not.toBe(
      firstKey,
    );
  });

  it('uses a new key after changing the account, the date or the switch', async () => {
    const wrapper = mountSheet();
    await pickAccount(wrapper);
    const keys: string[] = [];
    async function attempt() {
      await wrapper.get('[data-testid="pay-submit"]').trigger('click');
      keys.push((submits(wrapper).at(-1)?.[0] as { idempotencyKey: string }).idempotencyKey);
      await wrapper.setProps({ pending: true });
      await wrapper.setProps({ pending: false });
    }
    await typeAmount(wrapper, '1000.00');
    await attempt();
    await pickAccount(wrapper, 'acc-2');
    await attempt();
    wrapper.findComponent(UiDatePicker).vm.$emit('update:modelValue', '2026-09-20');
    await nextTick();
    await attempt();
    await wrapper.get('[data-testid="pay-will-pay-more"]').setValue(true);
    await attempt();
    expect(new Set(keys).size).toBe(4);
    expect(submits(wrapper)[2]?.[0]).toEqual(expect.objectContaining({ occurredOn: '2026-09-20' }));
  });

  it('formats the planned date in Russian and focuses the amount field on open', async () => {
    const wrapper = mountSheet();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(wrapper.text()).toContain('10 сен');
    expect(wrapper.text()).not.toContain('2026-09-10');
    expect(document.activeElement?.id).toBe('obligation-pay-amount');
  });

  it('shows server errors beside the form and field errors beside the field', async () => {
    const wrapper = mountSheet({
      error: 'Обязательство уже закрыто.',
      fieldErrors: { amount: 'Сумма должна быть больше нуля.' },
    });
    await nextTick();
    expect(wrapper.get('[data-testid="pay-error"]').text()).toContain('Обязательство уже закрыто.');
    expect(wrapper.text()).toContain('Сумма должна быть больше нуля.');
  });

  it('cannot be submitted when the plan has no category', async () => {
    const wrapper = mountSheet({
      occurrence: {
        id: 'occ-3',
        name: 'Без категории',
        scheduledOn: '2026-09-10',
        expectedMinor: '100000',
        categoryId: null,
      },
    });
    await pickAccount(wrapper);
    await wrapper.get('[data-testid="pay-submit"]').trigger('click');
    expect(submits(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain('У плана нет категории');
  });
});
