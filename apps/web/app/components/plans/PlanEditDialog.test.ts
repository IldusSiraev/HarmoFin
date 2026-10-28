import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import type { PlanCatalogEntry } from './plan-edit.js';
import PlanEditDialog from './PlanEditDialog.vue';

const rent: PlanCatalogEntry = {
  kind: 'obligation',
  id: 'plan-1',
  name: 'Аренда',
  amountMinor: '4000000',
  recurrence: 'MONTHLY',
  intervalMonths: null,
  scheduledOn: '2026-10-05',
  active: true,
  owner: { userId: 'user-1', displayName: null, isActiveMember: true },
  canEdit: true,
};
const salary: PlanCatalogEntry = { ...rent, kind: 'income', id: 'plan-2', name: 'Зарплата' };

const confirmStub = {
  UiConfirmDialog: {
    props: ['open', 'title', 'description', 'confirmLabel'],
    emits: ['confirm', 'cancel'],
    template:
      '<div v-if="open" data-testid="stop-confirm"><p>{{ title }}</p><p>{{ description }}</p><button data-testid="stop-confirm-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-testid="stop-confirm-no" @click="$emit(\'cancel\')">Отмена</button></div>',
  },
};

const wrappers: Array<{ unmount: () => void }> = [];
function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(PlanEditDialog, {
    props: { open: true, entry: rent, pending: false, error: null, fieldErrors: {}, ...props },
    attachTo: document.body,
    global: { stubs: { teleport: true, ...confirmStub } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
type Wrapper = ReturnType<typeof mountDialog>;

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

const amountInput = (wrapper: Wrapper) =>
  wrapper.get('#operation-amount-input').element as HTMLInputElement;
const nameInput = (wrapper: Wrapper) =>
  wrapper.get('#planEditName-input').element as HTMLInputElement;
const submit = (wrapper: Wrapper) => wrapper.get('[data-testid="plan-edit-submit"]');

describe('PlanEditDialog', () => {
  it('shows the plan values and the read-only fields with the hint', () => {
    const wrapper = mountDialog();
    expect(nameInput(wrapper).value).toBe('Аренда');
    expect(amountInput(wrapper).value).toBe('40000.00');
    const readonly = wrapper.get('[data-testid="plan-edit-readonly"]').text();
    expect(readonly).toContain('Каждый месяц');
    expect(readonly).toContain('Чтобы изменить их, остановите план и создайте новый.');
    expect(wrapper.find('[aria-label="Увеличить сумму"]').exists()).toBe(false);
  });

  it('keeps Save disabled until something changes', async () => {
    const wrapper = mountDialog();
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('#planEditName-input').setValue('Квартира');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('#planEditName-input').setValue('Аренда');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
  });

  it('shows the apply-to-current checkbox only when the amount changed, off by default', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('[data-testid="plan-edit-apply-current"]').exists()).toBe(false);
    await wrapper.get('#operation-amount-input').setValue('50000');
    const box = wrapper.get('[data-testid="plan-edit-apply-current"]');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.text()).toContain('Применить к текущим открытым платежам, включая просроченные');
    const hintId = box.attributes('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(wrapper.get(`#${hintId}`).text()).toContain('Будущие платежи изменятся в любом случае');
    await wrapper.get('#operation-amount-input').setValue('40 000');
    expect(wrapper.find('[data-testid="plan-edit-apply-current"]').exists()).toBe(false);
  });

  it('uses the income wording for an income plan', async () => {
    const wrapper = mountDialog({ entry: salary });
    await wrapper.get('#operation-amount-input').setValue('50000');
    expect(wrapper.text()).toContain('Применить к текущим ожидаемым поступлениям');
  });

  it('emits only the changed fields, with the flag only when checked', async () => {
    const wrapper = mountDialog();
    await wrapper.get('#operation-amount-input').setValue('50000,5');
    await wrapper.get('[data-testid="plan-edit-apply-current"]').setValue(true);
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('save')).toEqual([[{ amount: '50000.50', applyToCurrentOpen: true }]]);

    await wrapper.get('[data-testid="plan-edit-apply-current"]').setValue(false);
    await submit(wrapper).trigger('click');
    expect(wrapper.emitted('save')?.[1]).toEqual([{ amount: '50000.50' }]);
  });

  it('blocks Save on local errors and focuses the first invalid field', async () => {
    const wrapper = mountDialog();
    await wrapper.get('#planEditName-input').setValue('   ');
    await wrapper.get('#operation-amount-input').setValue('0');
    await submit(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('Укажите название');
    expect(wrapper.text()).toContain('Введите сумму больше нуля');
    expect(document.activeElement?.id).toBe('operation-amount-input');
  });

  it('shows server field errors and the general alert and keeps the input', async () => {
    const wrapper = mountDialog({
      error: 'Не удалось сохранить план. Попробуйте ещё раз.',
      fieldErrors: { name: 'Название занято' },
    });
    await wrapper.get('#planEditName-input').setValue('Квартира');
    expect(wrapper.text()).toContain('Название занято');
    expect(wrapper.findAll('[role="alert"]').map((node) => node.text())).toContain(
      'Не удалось сохранить план. Попробуйте ещё раз.',
    );
    expect(nameInput(wrapper).value).toBe('Квартира');
  });

  it('disables Save and shows the loading state while pending', async () => {
    const wrapper = mountDialog({ pending: true });
    await wrapper.get('#planEditName-input').setValue('Квартира');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    expect(submit(wrapper).attributes('aria-busy')).toBe('true');
  });

  it('stops the plan only after confirmation', async () => {
    const wrapper = mountDialog();
    expect(wrapper.find('[data-testid="stop-confirm"]').exists()).toBe(false);
    await wrapper.get('[data-testid="plan-edit-stop"]').trigger('click');
    const confirm = wrapper.get('[data-testid="stop-confirm"]').text();
    expect(confirm).toContain('Остановить план «Аренда»?');
    expect(confirm).toContain('Будущие неоплаченные платежи будут отменены.');
    expect(confirm).toContain('Текущие и просроченные останутся: оплатите или пропустите их.');
    expect(wrapper.emitted('stop')).toBeUndefined();

    await wrapper.get('[data-testid="stop-confirm-no"]').trigger('click');
    expect(wrapper.find('[data-testid="stop-confirm"]').exists()).toBe(false);
    expect(wrapper.emitted('stop')).toBeUndefined();

    await wrapper.get('[data-testid="plan-edit-stop"]').trigger('click');
    await wrapper.get('[data-testid="stop-confirm-yes"]').trigger('click');
    expect(wrapper.emitted('stop')).toHaveLength(1);
  });

  it('uses the income wording in the stop confirmation', async () => {
    const wrapper = mountDialog({ entry: salary });
    await wrapper.get('[data-testid="plan-edit-stop"]').trigger('click');
    expect(wrapper.get('[data-testid="stop-confirm"]').text()).toContain(
      'Будущие ожидаемые поступления будут отменены.',
    );
  });

  it('resets the form on each open and has accessible labels and a close button', async () => {
    const wrapper = mountDialog();
    await wrapper.get('#planEditName-input').setValue('Квартира');
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect(nameInput(wrapper).value).toBe('Аренда');
    expect(wrapper.find('label[for="planEditName-input"]').exists()).toBe(true);
    expect(wrapper.find('label[for="operation-amount-input"]').exists()).toBe(true);
    await wrapper.get('[aria-label="Закрыть"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
