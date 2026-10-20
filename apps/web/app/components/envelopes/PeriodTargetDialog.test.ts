import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';

const BUDGET = '0190a000-0000-7000-8000-000000000001';
const ENVELOPE_ID = '0190a000-0000-7000-8000-0000000000e1';

const mocks = vi.hoisted(() => ({
  v2: {
    updateFundingRule: vi.fn(),
    updatePeriodTarget: vi.fn(),
    updateIncomeCategorySuggestion: vi.fn(),
    assignFree: vi.fn(),
    move: vi.fn(),
    confirmFunding: vi.fn(),
  },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));

import PeriodTargetDialog from './PeriodTargetDialog.vue';

function envelope(overrides: Partial<EnvelopePlanDto> = {}): EnvelopePlanDto {
  return {
    id: ENVELOPE_ID,
    name: 'Ремонт',
    envelopeType: 'SAVINGS_GOAL',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '4000000',
    spentMinor: '1200000',
    balanceMinor: '2800000',
    archivedAt: null,
    ...overrides,
  };
}

const wrappers: Array<{ unmount: () => void }> = [];
async function mountDialog(periodStart: string | null = '2026-10-01') {
  const wrapper = mount(PeriodTargetDialog, {
    props: { open: true, budgetId: BUDGET, envelope: envelope(), periodStart },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
async function click(selector: string) {
  const el = q<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
  await flushPromises();
}
async function type(selector: string, value: string) {
  const input = q<HTMLInputElement>(selector);
  if (!input) throw new Error(`missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

function problem(status: number, field: string) {
  return new ApiRequestError(status, {
    code: 'VALIDATION_FAILED',
    detail: 'bad',
    fieldErrors: [{ field, message: 'raw english message', code: 'invalid' }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.updatePeriodTarget.mockResolvedValue({ periodId: 'p1' });
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('PeriodTargetDialog', () => {
  it('explains that the current target cannot be changed when the period is unknown', async () => {
    await mountDialog(null);
    expect(text()).toContain('Текущая цель периода недоступна');
    expect(q('[data-testid="target-confirm"]')).toBeNull();
  });

  it('shows consequences and calls updatePeriodTarget only after confirmation', async () => {
    await mountDialog('2026-10-01');

    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
    expect(text()).toContain('подтверждённая цель периода с');

    await type('[data-testid="target-input"]', '65000');
    await click('[data-testid="target-confirm"]');

    expect(mocks.v2.updatePeriodTarget).toHaveBeenCalledTimes(1);
    const call = mocks.v2.updatePeriodTarget.mock.calls[0] as unknown[];
    expect(call.slice(0, 4)).toEqual([BUDGET, ENVELOPE_ID, '2026-10-01', { target: '65000' }]);
  });

  it('отмена закрывает диалог без запроса', async () => {
    const wrapper = await mountDialog();
    await click('[data-testid="target-cancel"]');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
  });

  it('эмитит changed после подтверждения', async () => {
    const wrapper = await mountDialog();
    await type('[data-testid="target-input"]', '100');
    await click('[data-testid="target-confirm"]');
    expect(wrapper.emitted('changed')?.[0]).toEqual(['Цель текущего периода изменена.']);
  });

  describe('focus of the target block', () => {
    it('focuses the field on open and on a validation error', async () => {
      await mountDialog('2026-10-01');
      await flushPromises();
      expect(document.activeElement).toBe(q('[data-testid="target-input"]'));

      await type('[data-testid="target-input"]', 'abc');
      await click('[data-testid="target-confirm"]');
      expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(q('[data-testid="target-input"]'));
      expect(q('[data-testid="target-input"]')?.getAttribute('aria-describedby')).toContain(
        'target-input-hint',
      );

      await type('[data-testid="target-input"]', '0');
      await click('[data-testid="target-confirm"]');
      expect(mocks.v2.updatePeriodTarget.mock.calls[0]?.[3]).toEqual({ target: '0' });
    });
  });

  describe('idempotency keys', () => {
    const keyOf = (mock: { mock: { calls: unknown[][] } }, index: number, at: number) =>
      mock.mock.calls[index]?.[at] as string;

    it('target: same payload retried keeps the key, a repeat or a change rotates it', async () => {
      mocks.v2.updatePeriodTarget
        .mockRejectedValueOnce(new ApiRequestError(500, { code: 'X', detail: 'raw boom' }))
        .mockResolvedValue({});
      await mountDialog('2026-10-01');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      await click('[data-testid="target-confirm"]');
      const calls = mocks.v2.updatePeriodTarget;
      expect(keyOf(calls, 0, 4)).toBe(keyOf(calls, 1, 4));

      await type('[data-testid="target-input"]', '200');
      await click('[data-testid="target-confirm"]');
      expect(keyOf(calls, 2, 4)).not.toBe(keyOf(calls, 1, 4));
    });

    it('target: a double submit makes one call', async () => {
      let release: (value: unknown) => void = () => undefined;
      mocks.v2.updatePeriodTarget.mockReturnValue(new Promise((resolve) => (release = resolve)));
      await mountDialog('2026-10-01');
      await type('[data-testid="target-input"]', '100');
      q<HTMLElement>('[data-testid="target-confirm"]')?.click();
      q<HTMLElement>('[data-testid="target-confirm"]')?.click();
      await flushPromises();
      expect(mocks.v2.updatePeriodTarget).toHaveBeenCalledTimes(1);
      release({});
      await flushPromises();
    });
  });

  describe('server errors', () => {
    it('shows server field errors for the target at the field', async () => {
      mocks.v2.updatePeriodTarget.mockRejectedValue(problem(400, 'target'));
      await mountDialog('2026-10-01');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      const error = q('[data-testid="target-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).not.toContain('raw english');
      expect(q('[data-testid="target-input"]')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(q('[data-testid="target-input"]'));
    });

    it('shows a Russian form error without the raw detail', async () => {
      const failure = new ApiRequestError(500, { code: 'BOOM', detail: 'raw technical detail' });
      mocks.v2.updatePeriodTarget.mockRejectedValue(failure);
      await mountDialog('2026-10-01');

      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');

      const message = q('[data-testid="target-form-error"]')?.textContent ?? '';
      expect(message).toMatch(/[А-Яа-я]/);
      expect(message).not.toContain('raw technical detail');
    });
  });
});
