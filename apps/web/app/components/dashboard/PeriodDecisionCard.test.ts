import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

enableAutoUnmount(afterEach);

const v2Api = vi.hoisted(() => ({
  move: vi.fn(),
  listEnvelopes: vi.fn(),
  confirmPeriodTarget: vi.fn(),
  rejectPeriodTarget: vi.fn(),
}));
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => v2Api }));

import PeriodDecisionCard from './PeriodDecisionCard.vue';

type Warning = DashboardV2Response['warnings'][number];

const leftover: Warning = {
  kind: 'PERIOD',
  code: 'PERIOD_LEFTOVER',
  message: 'Остаток прошлого периода 10 000,00 ₽ ещё не передан.',
  amountMinor: '1000000',
  envelopeId: 'env-current',
  periodId: 'period-old',
  balanceMinor: '1000000',
  actionPath: '/app/envelopes?leftoverPeriod=period-old',
};
const deficit: Warning = {
  ...leftover,
  code: 'PERIOD_DEFICIT',
  message: 'Перерасход прошлого периода 10 000,00 ₽.',
  balanceMinor: '-1000000',
  actionPath: '/app/envelopes?coverPeriod=period-old',
};

function envelope(id: string, name: string, envelopeType: string) {
  return {
    id,
    name,
    envelopeType,
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '0',
    spentMinor: '0',
    balanceMinor: '0',
    archivedAt: null,
  };
}

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

function mountCard(
  warnings: Warning[],
  extra: { suggestedTarget?: string | null; periodId?: string | null; attach?: boolean } = {},
) {
  return mount(PeriodDecisionCard, {
    ...(extra.attach ? { attachTo: document.body } : {}),
    props: {
      budgetId: 'budget-id',
      warnings,
      suggestedTarget: extra.suggestedTarget ?? null,
      periodId: extra.periodId === undefined ? 'period-new' : extra.periodId,
      protectedAssignments: [
        {
          envelopeId: 'env-current',
          envelopeName: 'Текущие',
          envelopeType: 'MAIN',
          periodId: 'period-old',
          balanceMinor: '1000000',
        },
      ],
    },
    global: { stubs },
  });
}

async function chooseAction(wrapper: ReturnType<typeof mountCard>, action: string) {
  await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
  await wrapper.get(`[data-action="${action}"]`).trigger('click');
  await flushPromises();
}

describe('PeriodDecisionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    v2Api.move.mockResolvedValue({ movementId: 'm1' });
    v2Api.confirmPeriodTarget.mockResolvedValue({ periodId: 'period-new' });
    v2Api.rejectPeriodTarget.mockResolvedValue({ periodId: 'period-new' });
    v2Api.listEnvelopes.mockResolvedValue({
      items: [
        envelope('env-save-1', 'Отпуск', 'SAVINGS_GOAL'),
        envelope('env-save-2', 'Ремонт', 'SAVINGS_GOAL'),
        envelope('env-mand', 'Обязательные', 'MANDATORY_EXPENSES'),
      ],
    });
  });

  it('shows the previous period leftover without moving anything', async () => {
    const wrapper = mountCard([leftover]);
    await flushPromises();

    const text = wrapper.text().replace(/\s/g, ' ');
    expect(text).toContain('10 000,00 ₽');
    expect(text).toContain('Текущие');
    expect(v2Api.move).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
  });

  it('moves to free only after explicit confirmation, once, with a stable key', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');

    expect(v2Api.move).not.toHaveBeenCalled();
    const input = wrapper.get<HTMLInputElement>('[data-testid="leftover-amount"]');
    expect(input.element.value).toBe('10000.00');

    const confirm = wrapper.get('[data-testid="leftover-confirm"]');
    await Promise.all([confirm.trigger('click'), confirm.trigger('click')]);
    await flushPromises();

    expect(v2Api.move).toHaveBeenCalledTimes(1);
    const [budgetId, body, key] = v2Api.move.mock.calls[0]!;
    expect(budgetId).toBe('budget-id');
    expect(body).toEqual({
      sourceEnvelopeId: 'env-current',
      sourcePeriodId: 'period-old',
      destinationEnvelopeId: null,
      amount: '10000.00',
    });
    expect(typeof key).toBe('string');
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('lets the user choose between several savings envelopes before moving', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-savings');

    expect(wrapper.find('input[type="radio"]').exists()).toBe(true);
    expect(wrapper.find('fieldset legend').exists()).toBe(true);
    await wrapper.get('[data-testid="leftover-destination-env-save-2"]').setValue(true);
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(v2Api.move).toHaveBeenCalledTimes(1);
    expect(v2Api.move.mock.calls[0]![1]).toEqual({
      sourceEnvelopeId: 'env-current',
      sourcePeriodId: 'period-old',
      destinationEnvelopeId: 'env-save-2',
      amount: '10000.00',
    });
  });

  it('preselects the only mandatory envelope', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-mandatory');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(v2Api.move.mock.calls[0]![1]).toMatchObject({ destinationEnvelopeId: 'env-mand' });
  });

  it('keeps Move available without a destination and explains with a field error', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-savings');

    const confirm = wrapper.get('[data-testid="leftover-confirm"]');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="leftover-destination-error"]').text()).toBe(
      'Выберите конверт',
    );
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it.each([['0'], ['0.00'], ['0,0']])('blocks zero amount %s on the client', async (value) => {
    const wrapper = mountCard([leftover], { attach: true });
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-amount"]').setValue(value);
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    const error = wrapper.get('[data-testid="leftover-amount-error"]');
    expect(error.attributes('role')).toBe('alert');
    expect(document.activeElement).toBe(wrapper.get('#leftover-amount').element);
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it('normalizes a decimal comma in the request body', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-amount"]').setValue('10,5');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(v2Api.move.mock.calls[0]![1].amount).toBe('10.5');
  });

  it('focuses the amount after a failed submit', async () => {
    v2Api.move.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'INSUFFICIENT_ENVELOPE_BALANCE', detail: 'x' } as never),
    );
    const wrapper = mountCard([leftover], { attach: true });
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('#leftover-amount').element);
  });

  it('guards a second submit while the first move is still pending', async () => {
    let resolve!: (value: unknown) => void;
    v2Api.move.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    const vm = wrapper.vm as unknown as { confirmMove: () => Promise<void> };

    const first = vm.confirmMove();
    const second = vm.confirmMove();
    await flushPromises();
    expect(v2Api.move).toHaveBeenCalledTimes(1);
    resolve({ movementId: 'm1' });
    await Promise.all([first, second]);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('guards a second target decision while the first is pending', async () => {
    let resolve!: (value: unknown) => void;
    v2Api.rejectPeriodTarget.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const wrapper = mountCard([], { suggestedTarget: '5000000' });
    const vm = wrapper.vm as unknown as { decideTarget: (kind: 'reject') => Promise<void> };

    const first = vm.decideTarget('reject');
    const second = vm.decideTarget('reject');
    await flushPromises();
    expect(v2Api.rejectPeriodTarget).toHaveBeenCalledTimes(1);
    resolve({});
    await Promise.all([first, second]);
  });

  it('shows a Russian error when confirming a target that is no longer a draft', async () => {
    v2Api.confirmPeriodTarget.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'PERIOD_TARGET_NOT_DRAFT', detail: 'x' } as never),
    );
    const wrapper = mountCard([], { suggestedTarget: '5000000' });
    await wrapper.get('[data-testid="target-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="target-error"]').text()).toContain('План периода уже');
    expect(wrapper.emitted('changed')).toBeUndefined();

    await wrapper.get('[data-testid="target-confirm"]').trigger('click');
    await flushPromises();
    const [first, second] = v2Api.confirmPeriodTarget.mock.calls;
    expect(second![2]).toBe(first![2]);

    await wrapper.get('[data-testid="target-reject"]').trigger('click');
    await flushPromises();
    expect(v2Api.rejectPeriodTarget.mock.calls[0]![2]).not.toBe(first![2]);
  });

  it('moves focus to the heading after Keep for now when rows remain', async () => {
    const second = { ...leftover, envelopeId: 'env-2', periodId: 'period-old-2' };
    const wrapper = mountCard([leftover, second], { attach: true });
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');
    await wrapper.get('[data-action="leftover-keep"]').trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('#period-decision-title').element);
  });

  it('asks the page for a focus fallback when Keep for now removes the whole card', async () => {
    const wrapper = mountCard([leftover], { attach: true });
    await chooseAction(wrapper, 'leftover-keep');

    expect(wrapper.emitted('focus-fallback')).toHaveLength(1);
  });

  it('does not guess the next period: that action is unavailable', async () => {
    const wrapper = mountCard([leftover]);
    await wrapper.get('[data-testid="action-menu-trigger"]').trigger('click');

    const next = wrapper.get('[data-action="leftover-next"]');
    expect(next.attributes('aria-disabled')).toBe('true');
    expect(next.text()).toContain('период ещё не создан');
    await next.trigger('click');
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it('keep-for-now and closing the panel never call the API', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="drawer-close"]').trigger('click');
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    expect(wrapper.text().replace(/\s/g, ' ')).toContain('10 000,00');

    await chooseAction(wrapper, 'leftover-keep');
    expect(v2Api.move).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="leftover-row"]').exists()).toBe(false);
  });

  it('shows a Russian error on 409, keeps the key on retry and renews it after a change', async () => {
    v2Api.move.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'INSUFFICIENT_ENVELOPE_BALANCE', detail: 'x' } as never),
    );
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="leftover-error"]').text()).toContain('Нельзя перенести');
    expect(wrapper.emitted('changed')).toBeUndefined();

    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();
    const [first, second] = v2Api.move.mock.calls;
    expect(second![2]).toBe(first![2]);
  });

  it('uses a new key when the amount changes', async () => {
    v2Api.move.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'INSUFFICIENT_ENVELOPE_BALANCE', detail: 'x' } as never),
    );
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="leftover-amount"]').setValue('50.00');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    const [first, second] = v2Api.move.mock.calls;
    expect(second![2]).not.toBe(first![2]);
    expect(second![1].amount).toBe('50.00');
  });

  it('rejects a malformed amount with a field error and no request', async () => {
    const wrapper = mountCard([leftover]);
    await chooseAction(wrapper, 'leftover-free');
    await wrapper.get('[data-testid="leftover-amount"]').setValue('abc');
    await wrapper.get('[data-testid="leftover-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="leftover-amount-error"]').text()).not.toBe('');
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it('offers only a cover task for a negative previous-period balance', () => {
    const wrapper = mountCard([deficit]);

    expect(wrapper.text()).not.toContain('Перенести');
    expect(wrapper.text()).toContain('Превышение:');
    expect(wrapper.find('[data-testid="action-menu-trigger"]').exists()).toBe(false);
    expect(wrapper.get('a[href="/app/envelopes?coverPeriod=period-old"]')).toBeTruthy();
    expect(v2Api.move).not.toHaveBeenCalled();
  });

  it('presents the draft target as a proposal and confirms it only on click', async () => {
    const wrapper = mountCard([], { suggestedTarget: '5000000' });
    await flushPromises();

    const text = wrapper.text().replace(/\s/g, ' ');
    expect(text).toContain('Предложенный план периода');
    expect(text).toContain('50 000,00 ₽');
    expect(v2Api.confirmPeriodTarget).not.toHaveBeenCalled();

    const confirm = wrapper.get('[data-testid="target-confirm"]');
    await Promise.all([confirm.trigger('click'), confirm.trigger('click')]);
    await flushPromises();

    expect(v2Api.confirmPeriodTarget).toHaveBeenCalledTimes(1);
    expect(v2Api.confirmPeriodTarget.mock.calls[0]![0]).toBe('budget-id');
    expect(v2Api.confirmPeriodTarget.mock.calls[0]![1]).toBe('period-new');
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('rejects the draft target only on click', async () => {
    const wrapper = mountCard([], { suggestedTarget: '5000000' });
    expect(v2Api.rejectPeriodTarget).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="target-reject"]').trigger('click');
    await flushPromises();

    expect(v2Api.rejectPeriodTarget).toHaveBeenCalledTimes(1);
    expect(v2Api.confirmPeriodTarget).not.toHaveBeenCalled();
  });

  it('renders nothing when there is nothing to decide', () => {
    const wrapper = mountCard([]);
    expect(wrapper.find('[data-testid="period-decision-card"]').exists()).toBe(false);
  });
});
