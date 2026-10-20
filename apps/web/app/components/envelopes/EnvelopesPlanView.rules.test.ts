import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const BUDGET = '0190a000-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  v2: {
    listEnvelopes: vi.fn(),
    getDashboard: vi.fn(),
    getEnvelopeHistory: vi.fn(),
  },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useOperationReferenceData.js', () => ({
  useOperationReferenceData: () => ({ invalidate: vi.fn() }),
}));
vi.mock('../../composables/useToast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));

import EnvelopesPlanView from './EnvelopesPlanView.vue';
import EnvelopePlanDialog from './EnvelopePlanDialog.vue';

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
    protectedAssignments: assigned.map(([envelopeId, assignmentPeriodId]) => ({
      envelopeId,
      envelopeName: 'x',
      envelopeType: 'CURRENT_EXPENSES',
      periodId: assignmentPeriodId,
      balanceMinor: '100',
    })),
  };
}

const SheetStub = defineComponent({
  name: 'RuleSettingsSheet',
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
              'data-testid': 'sheet-stub',
              'data-envelope': (props.envelope as { id: string } | null)?.id,
              'data-period': props.periodStart ?? 'null',
            },
            [
              h('button', {
                'data-testid': 'stub-changed',
                onClick: () => emit('changed', 'Правило пополнения сохранено.'),
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
      stubs: {
        RuleSettingsSheet: SheetStub,
        EnvelopeMovePanel: true,
        NuxtLink: true,
        EnvelopePlanDialog: true,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
async function openRules(id: string) {
  q<HTMLElement>(`[data-testid="row-actions-${id}"]`)?.click();
  await flushPromises();
  q<HTMLElement>('[data-testid="row-rules"]')?.click();
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.listEnvelopes.mockResolvedValue({
    items: [envelope('e-a', 'Продукты'), envelope('e-b', 'Транспорт')],
  });
  mocks.v2.getEnvelopeHistory.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('EnvelopesPlanView rule settings entry', () => {
  it('opens the sheet with the envelope and the dashboard period when it has an assignment there', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p-1', [['e-a', 'p-1']]));
    await mountView();

    await openRules('e-a');

    const sheet = q('[data-testid="sheet-stub"]');
    expect(sheet?.getAttribute('data-envelope')).toBe('e-a');
    expect(sheet?.getAttribute('data-period')).toBe('2026-10-01');
    expect(mocks.v2.getDashboard).toHaveBeenCalledWith(BUDGET);
  });

  it('gives periodStart=null when the envelope has no assignment in the dashboard period', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p-1', [['e-a', 'p-0']]));
    await mountView();
    await openRules('e-a');
    expect(q('[data-testid="sheet-stub"]')?.getAttribute('data-period')).toBe('null');
  });

  it('gives periodStart=null when the dashboard has no period id or fails', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', null, [['e-a', 'p-1']]));
    await mountView();
    await openRules('e-a');
    expect(q('[data-testid="sheet-stub"]')?.getAttribute('data-period')).toBe('null');

    document.body.innerHTML = '';
    wrappers.pop()?.unmount();
    mocks.v2.getDashboard.mockRejectedValue(new Error('down'));
    await mountView();
    await openRules('e-a');
    expect(q('[data-testid="sheet-stub"]')?.getAttribute('data-period')).toBe('null');
  });

  it('re-reads the envelope list after the sheet reports a change', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p-1', [['e-a', 'p-1']]));
    await mountView();
    await openRules('e-a');
    const before = mocks.v2.listEnvelopes.mock.calls.length;

    q<HTMLElement>('[data-testid="stub-changed"]')?.click();
    await flushPromises();

    expect(mocks.v2.listEnvelopes.mock.calls.length).toBe(before + 1);
    expect(document.body.textContent).toContain('Правило пополнения сохранено.');
  });

  it('does not leak a slow answer of a previous envelope into the current one', async () => {
    let releaseA: (value: unknown) => void = () => undefined;
    mocks.v2.getDashboard
      .mockImplementationOnce(() => new Promise((resolve) => (releaseA = resolve)))
      .mockResolvedValueOnce(dashboard('2026-10-01', 'p-1', [['e-b', 'p-1']]));
    await mountView();

    await openRules('e-a');
    await openRules('e-b');
    releaseA(dashboard('2026-09-01', 'p-0', [['e-a', 'p-0']]));
    await flushPromises();

    const sheet = q('[data-testid="sheet-stub"]');
    expect(sheet?.getAttribute('data-envelope')).toBe('e-b');
    expect(sheet?.getAttribute('data-period')).toBe('2026-10-01');
  });
});

describe('EnvelopePlanDialog rules action', () => {
  it('emits rules with the envelope', async () => {
    const item = envelope('e-a', 'Продукты');
    const wrapper = mount(EnvelopePlanDialog, {
      props: { budgetId: BUDGET, envelope: item },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    q<HTMLElement>('[data-testid="plan-dialog-rules"]')?.click();
    expect(wrapper.emitted('rules')?.[0]).toEqual([item]);
  });
});
