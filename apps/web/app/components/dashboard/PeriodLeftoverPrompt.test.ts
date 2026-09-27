import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import PeriodLeftoverPrompt from './PeriodLeftoverPrompt.vue';

const leftover = {
  envelopeId: 'previous-envelope-id',
  envelopeName: 'Текущие 10–24',
  balanceMinor: '350000',
  currentPeriodEnvelopeId: 'current-envelope-id',
  currentPeriodEnvelopeName: 'Текущие 25–9',
};

const envelopes = [
  { id: 'previous-envelope-id', name: 'Текущие 10–24' },
  { id: 'current-envelope-id', name: 'Текущие 25–9' },
  { id: 'savings-envelope-id', name: 'Отпуск' },
];

const normalize = (value: string): string => value.replace(/[\u00A0\u202F]/g, ' ');

describe('PeriodLeftoverPrompt', () => {
  it('renders nothing without a leftover', () => {
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover: null, budgetId: 'budget-id', envelopes, createReallocation: vi.fn() },
    });

    expect(wrapper.find('[data-testid="period-leftover-prompt"]').exists()).toBe(false);
  });

  it('names both envelopes and the leftover amount', () => {
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation: vi.fn() },
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Текущие 10–24');
    expect(text).toContain('Текущие 25–9');
    expect(text).toContain('3 500,00 ₽');
  });

  it('moves the whole leftover into the current period envelope on one click', async () => {
    const createReallocation = vi.fn().mockResolvedValue({ id: 'reallocation-id' });
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation },
    });

    await wrapper.get('[data-action="move-all"]').trigger('click');
    await flushPromises();

    expect(createReallocation).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({
        sourceEnvelopeId: 'previous-envelope-id',
        destinationEnvelopeId: 'current-envelope-id',
        amount: '3500.00',
      }),
      expect.any(String),
    );
    expect(wrapper.emitted('reallocated')).toHaveLength(1);
  });

  it('opens a picker to distribute into a different envelope', async () => {
    const createReallocation = vi.fn().mockResolvedValue({ id: 'reallocation-id' });
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation },
    });

    await wrapper.get('[data-action="open-picker"]').trigger('click');
    await flushPromises();
    const destination = document.querySelector<HTMLSelectElement>(
      'select[name="destinationEnvelopeId"]',
    );
    if (!destination) throw new Error('picker is not rendered inside the modal');
    destination.value = 'savings-envelope-id';
    destination.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    const amount = document.querySelector<HTMLInputElement>('input[name="amount"]');
    if (!amount) throw new Error('picker is not rendered inside the modal');
    amount.value = '1 000,00';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    document.querySelector<HTMLButtonElement>('button[data-action="submit-picker"]')?.click();
    await flushPromises();

    expect(createReallocation).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({
        sourceEnvelopeId: 'previous-envelope-id',
        destinationEnvelopeId: 'savings-envelope-id',
        amount: '1000.00',
      }),
      expect.any(String),
    );
    expect(wrapper.emitted('reallocated')).toHaveLength(1);
  });
});
