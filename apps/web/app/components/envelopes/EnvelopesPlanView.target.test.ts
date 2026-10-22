import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const BUDGET = '0190a000-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  v2: {
    listEnvelopes: vi.fn(),
    getDashboard: vi.fn(),
    getEnvelopeHistory: vi.fn(),
    listFundingRules: vi.fn(),
  },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useOperationReferenceData.js', () => ({
  useOperationReferenceData: () => ({ invalidate: vi.fn() }),
}));
vi.mock('../../composables/useToast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../../composables/useFundingEntry.js', () => ({
  useFundingEntry: () => ({ confirmedCount: { value: 0 }, offer: vi.fn() }),
}));

import { NuxtLink } from '../../test/nuxt-components.js';
import EnvelopesPlanView from './EnvelopesPlanView.vue';

function envelope(id: string, name: string) {
  return {
    id,
    name,
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: 'FIRST',
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '100',
    spentMinor: '0',
    balanceMinor: '100',
    archivedAt: null,
  };
}

function dashboard(start: string, periodId: string | null, assigned: Array<[string, string]>) {
  return {
    period: { start, end: '2026-10-14', periodId },
    spendable: { state: 'READY', amountMinor: '100' },
    suggestedTarget: null,
    cashMinor: '200',
    mandatoryBalanceMinor: '0',
    otherProtectedMinor: '0',
    freeToAssignMinor: '0',
    mandatoryGapMinor: '0',
    unbackedMinor: '0',
    warnings: [],
    protectedAssignments: assigned.map(([envelopeId, assignmentPeriodId]) => ({
      envelopeId,
      envelopeName: 'x',
      envelopeType: 'CURRENT_EXPENSES',
      periodId: assignmentPeriodId,
      balanceMinor: '100',
    })),
  };
}

const TargetStub = defineComponent({
  name: 'PeriodTargetDialog',
  props: {
    open: Boolean,
    budgetId: { type: String, default: '' },
    envelope: { type: Object, default: null },
    periodStart: { type: String, default: null },
  },
  emits: ['close', 'changed'],
  setup(props, { emit }) {
    return () =>
      props.open
        ? h(
            'div',
            {
              'data-testid': 'target-stub',
              'data-envelope': (props.envelope as { id: string } | null)?.id,
              'data-period': props.periodStart ?? 'null',
            },
            [
              h('button', {
                'data-testid': 'stub-changed',
                onClick: () => emit('changed', 'Цель текущего периода изменена.'),
              }),
            ],
          )
        : null;
  },
});

const wrappers: Array<{ unmount: () => void }> = [];
async function mountView() {
  const wrapper = mount(EnvelopesPlanView, {
    props: { budgetId: BUDGET, query: {} },
    attachTo: document.body,
    global: {
      components: { NuxtLink },
      stubs: {
        PeriodTargetDialog: TargetStub,
        EnvelopeMovePanel: true,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function openDetails(wrapper: VueWrapper, id: string) {
  await wrapper
    .find(`[data-testid="envelope-row-${id}"] [data-testid="list-row-select"]`)
    .trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.listEnvelopes.mockResolvedValue({
    items: [envelope('env-a', 'Продукты'), envelope('env-b', 'Транспорт')],
  });
  mocks.v2.getEnvelopeHistory.mockResolvedValue({ items: [], nextCursor: null });
  mocks.v2.listFundingRules.mockResolvedValue({ items: [] });
  mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', null, []));
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('EnvelopesPlanView: правила и цель периода', () => {
  it('рядом с «Создать конверт» есть ссылка «Задать правила», в меню строки нет «Правило пополнения»', async () => {
    const wrapper = await mountView();
    const link = wrapper.find('[data-action="envelope-rules"]');
    expect(link.text()).toBe('Задать правила');
    expect(link.attributes('href') ?? link.attributes('to')).toBe('/app/envelopes/rules');
    expect(wrapper.find('[data-testid="row-rules"]').exists()).toBe(false);
  });

  it('диалог конверта показывает правило и номер в очереди', async () => {
    mocks.v2.listFundingRules.mockResolvedValue({
      items: [
        {
          id: 'r1',
          envelopeId: 'env-b',
          type: 'SUM_OF_PLANS',
          priority: 10,
          fixedAmountMinor: null,
          percentBasisPoints: null,
        },
        {
          id: 'r2',
          envelopeId: 'env-a',
          type: 'PERCENT_OF_INCOME',
          priority: 20,
          fixedAmountMinor: null,
          percentBasisPoints: 1000,
        },
      ],
    });
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    expect(document.body.textContent).toContain('Процент от дохода, 10 % · №2 в очереди');
  });

  it('правило архивного конверта не сдвигает номер в очереди', async () => {
    mocks.v2.listEnvelopes.mockResolvedValue({
      items: [
        envelope('env-a', 'Продукты'),
        { ...envelope('env-z', 'Старый'), archivedAt: '2026-09-01T00:00:00.000Z' },
      ],
    });
    mocks.v2.listFundingRules.mockResolvedValue({
      items: [
        {
          id: 'r0',
          envelopeId: 'env-z',
          type: 'SUM_OF_PLANS',
          priority: 10,
          fixedAmountMinor: null,
          percentBasisPoints: null,
        },
        {
          id: 'r2',
          envelopeId: 'env-a',
          type: 'PERCENT_OF_INCOME',
          priority: 20,
          fixedAmountMinor: null,
          percentBasisPoints: 1000,
        },
      ],
    });
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    expect(document.body.textContent).toContain('Процент от дохода, 10 % · №1 в очереди');
  });

  it('если правила не загрузились, страница работает без строки правила', async () => {
    mocks.v2.listFundingRules.mockRejectedValue(new Error('boom'));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    expect(document.querySelector('[data-testid="plan-history"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-rule"]')).toBeNull();
  });

  it('«Изменить цель периода» открывает диалог цели с периодом из дашборда', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p1', [['env-a', 'p1']]));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    const stub = wrapper.find('[data-testid="target-stub"]');
    expect(stub.attributes('data-envelope')).toBe('env-a');
    expect(stub.attributes('data-period')).toBe('2026-10-01');
    expect(mocks.v2.getDashboard).toHaveBeenCalledWith(BUDGET);
  });

  it('если дашборд недоступен, диалог цели открывается без периода', async () => {
    mocks.v2.getDashboard.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    const stub = wrapper.find('[data-testid="target-stub"]');
    expect(stub.attributes('data-envelope')).toBe('env-a');
    expect(stub.attributes('data-period')).toBe('null');
  });

  it('период чужого конверта не передаётся', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p1', [['env-b', 'p1']]));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.find('[data-testid="target-stub"]').attributes('data-period')).toBe('null');
  });

  it('диалог цели открывается только после ответа дашборда, устаревший ответ игнорируется', async () => {
    let releaseA: (value: unknown) => void = () => undefined;
    let releaseB: (value: unknown) => void = () => undefined;
    // The first read is the page summary loaded together with the list.
    mocks.v2.getDashboard
      .mockResolvedValueOnce(dashboard('2026-10-01', null, []))
      .mockImplementationOnce(() => new Promise((resolve) => (releaseA = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (releaseB = resolve)));
    const wrapper = await mountView();

    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.find('[data-testid="target-stub"]').exists()).toBe(false);

    await openDetails(wrapper, 'env-b');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    releaseA(dashboard('2026-09-01', 'p0', [['env-a', 'p0']]));
    await flushPromises();
    expect(wrapper.find('[data-testid="target-stub"]').exists()).toBe(false);

    releaseB(dashboard('2026-10-01', 'p1', [['env-b', 'p1']]));
    await flushPromises();
    const stub = wrapper.find('[data-testid="target-stub"]');
    expect(stub.attributes('data-envelope')).toBe('env-b');
    expect(stub.attributes('data-period')).toBe('2026-10-01');
  });

  it('после изменения цели диалог закрывается, список перечитывается', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p1', [['env-a', 'p1']]));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    const before = mocks.v2.listEnvelopes.mock.calls.length;
    const dashboardBefore = mocks.v2.getDashboard.mock.calls.length;

    await wrapper.find('[data-testid="stub-changed"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="target-stub"]').exists()).toBe(false);
    expect(mocks.v2.listEnvelopes.mock.calls.length).toBe(before + 1);
    expect(mocks.v2.getDashboard.mock.calls.length).toBe(dashboardBefore + 1);
    expect(document.body.textContent).toContain('Цель текущего периода изменена.');
  });
});
