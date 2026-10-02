import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';

const BUDGET = '0190a000-0000-7000-8000-000000000001';
const ENVELOPE_ID = '0190a000-0000-7000-8000-0000000000e1';
const CATEGORY_ID = '0190a000-0000-7000-8000-0000000000c1';

const mocks = vi.hoisted(() => ({
  v2: {
    updateFundingRule: vi.fn(),
    updatePeriodTarget: vi.fn(),
    updateIncomeCategorySuggestion: vi.fn(),
    assignFree: vi.fn(),
    move: vi.fn(),
    confirmFunding: vi.fn(),
  },
  reference: { listCategories: vi.fn() },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.reference,
}));

import RuleSettingsSheet from './RuleSettingsSheet.vue';

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

type Props = InstanceType<typeof RuleSettingsSheet>['$props'];
const wrappers: Array<{ unmount: () => void }> = [];
async function mountSheet(options: Partial<Props> & { noRule?: boolean } = {}) {
  const { noRule, ...props } = options;
  const base: { -readonly [K in keyof Props]: Props[K] } = {
    open: true,
    budgetId: BUDGET,
    envelope: envelope(),
    periodStart: null,
    initialRule: { type: 'SUGGESTED_FIXED', priority: 20, fixedAmount: '20000' },
    ...props,
  } as Props;
  if (noRule) delete base.initialRule;
  const wrapper = mount(RuleSettingsSheet, {
    props: base,
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
async function pick(selector: string, value: string) {
  const select = q<HTMLSelectElement>(selector);
  if (!select) throw new Error(`missing ${selector}`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
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
  mocks.v2.updateFundingRule.mockResolvedValue({
    id: 'r1',
    envelopeId: ENVELOPE_ID,
    type: 'SUGGESTED_FIXED',
    priority: 20,
    fixedAmountMinor: '3000000',
    percentBasisPoints: null,
  });
  mocks.v2.updatePeriodTarget.mockResolvedValue({ periodId: 'p1' });
  mocks.v2.updateIncomeCategorySuggestion.mockResolvedValue({
    enabled: true,
    sourceCategoryId: CATEGORY_ID,
    targetEnvelopeId: ENVELOPE_ID,
  });
  mocks.reference.listCategories.mockResolvedValue([
    { id: CATEGORY_ID, name: 'Кэшбэк', categoryType: 'INCOME', parentId: null, archivedAt: null },
  ]);
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('RuleSettingsSheet', () => {
  it('changes only the suggested amount: no target, assignment or movement calls', async () => {
    const wrapper = await mountSheet();

    expect(text()).toContain('Это предложение, не обязательный взнос');
    expect(q<HTMLInputElement>('[data-testid="rule-fixed"]')?.value).toBe('20000');

    await type('[data-testid="rule-fixed"]', '30000');
    await click('[data-testid="rule-save"]');

    expect(mocks.v2.updateFundingRule).toHaveBeenCalledTimes(1);
    const [budgetId, envelopeId, body, key] = mocks.v2.updateFundingRule.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      string,
    ];
    expect(budgetId).toBe(BUDGET);
    expect(envelopeId).toBe(ENVELOPE_ID);
    expect(body).toEqual({ type: 'SUGGESTED_FIXED', priority: 20, fixedAmount: '30000' });
    expect(key).toMatch(/\S+/);
    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
    expect(mocks.v2.assignFree).not.toHaveBeenCalled();
    expect(mocks.v2.move).not.toHaveBeenCalled();
    expect(mocks.v2.confirmFunding).not.toHaveBeenCalled();
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('protects against a double submit with one request and one key', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.v2.updateFundingRule.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await mountSheet();

    q<HTMLElement>('[data-testid="rule-save"]')?.click();
    q<HTMLElement>('[data-testid="rule-save"]')?.click();
    await flushPromises();
    expect(mocks.v2.updateFundingRule).toHaveBeenCalledTimes(1);
    release({});
    await flushPromises();
  });

  it('reuses the Idempotency-Key when the same attempt is retried after a failure', async () => {
    mocks.v2.updateFundingRule
      .mockRejectedValueOnce(new ApiRequestError(500, { code: 'X', detail: 'x' }))
      .mockResolvedValueOnce({});
    await mountSheet();

    await click('[data-testid="rule-save"]');
    await click('[data-testid="rule-save"]');
    const keys = mocks.v2.updateFundingRule.mock.calls.map((call) => call[3]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('accepts percent 0 and 100 and converts them to basis points as text', async () => {
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 5, percentBasisPoints: 1250 },
    });
    expect(q<HTMLInputElement>('[data-testid="rule-percent"]')?.value).toBe('12.5');

    await type('[data-testid="rule-percent"]', '0');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule.mock.calls[0]?.[2]).toEqual({
      type: 'PERCENT_OF_INCOME',
      priority: 5,
      percentBasisPoints: 0,
    });

    await type('[data-testid="rule-percent"]', '100');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule.mock.calls[1]?.[2]).toEqual({
      type: 'PERCENT_OF_INCOME',
      priority: 5,
      percentBasisPoints: 10000,
    });
    expect(q('[data-testid="rule-percent-error"]')).toBeNull();
  });

  it('rejects 101 percent at the field without calling the API', async () => {
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 5, percentBasisPoints: 1000 },
    });

    await type('[data-testid="rule-percent"]', '101');
    await click('[data-testid="rule-save"]');

    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(q('[data-testid="rule-percent-error"]')?.textContent).toContain('от 0 до 100');
    expect(q('[data-testid="rule-percent"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows an API field error at the field in Russian', async () => {
    mocks.v2.updateFundingRule.mockRejectedValue(problem(400, 'percentBasisPoints'));
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 5, percentBasisPoints: 1000 },
    });

    await click('[data-testid="rule-save"]');

    const error = q('[data-testid="rule-percent-error"]');
    expect(error?.textContent).toContain('Проценты');
    expect(error?.textContent).not.toContain('raw english');
    expect(q('[data-testid="rule-percent"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a field error for a negative or malformed amount without a request', async () => {
    await mountSheet();
    await type('[data-testid="rule-fixed"]', '-5');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(q('[data-testid="rule-fixed-error"]')).not.toBeNull();
  });

  it('offers SUM_OF_PLANS only for the mandatory envelope', async () => {
    await mountSheet();
    expect(q('[data-testid="rule-type"] option[value="SUM_OF_PLANS"]')).toBeNull();
    document.body.innerHTML = '';
    wrappers.pop()?.unmount();

    await mountSheet({
      envelope: envelope({ envelopeType: 'MANDATORY_EXPENSES', name: 'Обязательные' }),
      initialRule: { type: 'SUM_OF_PLANS', priority: 1 },
    });
    expect(q('[data-testid="rule-type"] option[value="SUM_OF_PLANS"]')).not.toBeNull();
  });

  it('explains that the current target cannot be changed when the period is unknown', async () => {
    await mountSheet({ periodStart: null });
    expect(q('[data-testid="target-open"]')).toBeNull();
    expect(text()).toContain('Текущая цель периода недоступна');
  });

  it('shows consequences and calls updatePeriodTarget only after confirmation', async () => {
    await mountSheet({ periodStart: '2026-10-01' });

    await click('[data-testid="target-open"]');
    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
    expect(text()).toContain('подтверждённая цель текущего периода изменится');

    await type('[data-testid="target-input"]', '65000');
    await click('[data-testid="target-confirm"]');

    expect(mocks.v2.updatePeriodTarget).toHaveBeenCalledTimes(1);
    const call = mocks.v2.updatePeriodTarget.mock.calls[0] as unknown[];
    expect(call.slice(0, 4)).toEqual([BUDGET, ENVELOPE_ID, '2026-10-01', { target: '65000' }]);
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(mocks.v2.assignFree).not.toHaveBeenCalled();
  });

  it('can cancel the target change without a request', async () => {
    await mountSheet({ periodStart: '2026-10-01' });
    await click('[data-testid="target-open"]');
    await click('[data-testid="target-cancel"]');
    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
    expect(q('[data-testid="target-input"]')).toBeNull();
  });

  it('saves the income category suggestion without assignments or movements', async () => {
    const wrapper = await mountSheet();
    expect(mocks.reference.listCategories).toHaveBeenCalledWith(BUDGET, 'INCOME', 'active');

    await pick('[data-testid="suggestion-category"]', CATEGORY_ID);
    await click('[data-testid="suggestion-save"]');

    const call = mocks.v2.updateIncomeCategorySuggestion.mock.calls[0] as unknown[];
    expect(call.slice(0, 2)).toEqual([
      BUDGET,
      { enabled: true, sourceCategoryId: CATEGORY_ID, targetEnvelopeId: ENVELOPE_ID },
    ]);
    expect(mocks.v2.assignFree).not.toHaveBeenCalled();
    expect(mocks.v2.move).not.toHaveBeenCalled();
    expect(mocks.v2.confirmFunding).not.toHaveBeenCalled();
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('turns the suggestion off with enabled=false and no category', async () => {
    await mountSheet();
    await click('[data-testid="suggestion-off"]');
    const call = mocks.v2.updateIncomeCategorySuggestion.mock.calls[0] as unknown[];
    expect(call[1]).toEqual({ enabled: false, sourceCategoryId: null, targetEnvelopeId: null });
  });

  it('requires a category before enabling the suggestion', async () => {
    await mountSheet();
    await click('[data-testid="suggestion-save"]');
    expect(mocks.v2.updateIncomeCategorySuggestion).not.toHaveBeenCalled();
    expect(q('[data-testid="suggestion-category-error"]')).not.toBeNull();
  });
});

describe('RuleSettingsSheet input, focus and keys', () => {
  describe('without a known current rule', () => {
    it('shows a placeholder type, requires type and priority, focuses the first error', async () => {
      await mountSheet({ noRule: true });
      const select = q<HTMLSelectElement>('[data-testid="rule-type"]');
      expect(select?.value).toBe('');
      expect(text()).toContain('Выберите тип');
      expect(text()).toContain('меньшим числом');

      await click('[data-testid="rule-save"]');
      expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
      expect(q('[data-testid="rule-type-error"]')).not.toBeNull();
      expect(q('[data-testid="rule-priority-error"]')).not.toBeNull();
      expect(document.activeElement).toBe(select);
    });

    it('requires a priority even when the type is chosen', async () => {
      await mountSheet({ noRule: true });
      await pick('[data-testid="rule-type"]', 'MANUAL');
      await click('[data-testid="rule-save"]');
      expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
      expect(q('[data-testid="rule-type-error"]')).toBeNull();
      expect(q('[data-testid="rule-priority-error"]')).not.toBeNull();
      expect(document.activeElement).toBe(q('[data-testid="rule-priority"]'));

      await type('[data-testid="rule-priority"]', '7');
      await click('[data-testid="rule-save"]');
      expect(mocks.v2.updateFundingRule.mock.calls[0]?.[2]).toEqual({
        type: 'MANUAL',
        priority: 7,
      });
    });
  });

  it('rejects an empty priority at the field', async () => {
    await mountSheet();
    await type('[data-testid="rule-priority"]', '');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(q('[data-testid="rule-priority-error"]')).not.toBeNull();
  });

  it('keeps format hints in aria-describedby together with the error', async () => {
    await mountSheet();
    const fixed = q<HTMLInputElement>('[data-testid="rule-fixed"]');
    expect(fixed?.getAttribute('aria-describedby')).toContain('rule-fixed-hint');
    expect(text()).toContain('больше нуля');

    await type('[data-testid="rule-fixed"]', '0');
    await click('[data-testid="rule-save"]');
    const describedBy = fixed?.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('rule-fixed-hint');
    expect(describedBy).toContain('rule-fixed-error');
  });

  it('shows the percent range hint', async () => {
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 5, percentBasisPoints: 1000 },
    });
    expect(q('[data-testid="rule-percent"]')?.getAttribute('aria-describedby')).toContain(
      'rule-percent-hint',
    );
    expect(text()).toContain('от 0 до 100');
  });

  it('requires a fixed amount above zero for the rule', async () => {
    await mountSheet();
    await type('[data-testid="rule-fixed"]', '0');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(q('[data-testid="rule-fixed-error"]')?.textContent).toContain('больше нуля');

    await type('[data-testid="rule-fixed"]', '0.00');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();

    await type('[data-testid="rule-fixed"]', '0.01');
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['12.5', 1250],
    ['0.01', 1],
    ['100.00', 10000],
    ['12,5', 1250],
    ['0', 0],
    ['100', 10000],
  ])('converts percent %s to %s basis points', async (input, expected) => {
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 100 },
    });
    await type('[data-testid="rule-percent"]', input);
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule.mock.calls[0]?.[2]).toEqual({
      type: 'PERCENT_OF_INCOME',
      priority: 1,
      percentBasisPoints: expected,
    });
  });

  it.each(['100.01', 'abc', '', '-1', '1.234'])('rejects percent "%s" at the field', async (v) => {
    await mountSheet({
      initialRule: { type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 100 },
    });
    await type('[data-testid="rule-percent"]', v);
    await click('[data-testid="rule-save"]');
    expect(mocks.v2.updateFundingRule).not.toHaveBeenCalled();
    expect(q('[data-testid="rule-percent-error"]')).not.toBeNull();
    expect(document.activeElement).toBe(q('[data-testid="rule-percent"]'));
  });

  describe('focus of the target block', () => {
    it('moves focus to the field, back to the opener on cancel and on success', async () => {
      await mountSheet({ periodStart: '2026-10-01' });
      await click('[data-testid="target-open"]');
      expect(document.activeElement).toBe(q('[data-testid="target-input"]'));

      await click('[data-testid="target-cancel"]');
      expect(document.activeElement).toBe(q('[data-testid="target-open"]'));

      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      expect(document.activeElement).toBe(q('[data-testid="target-open"]'));
    });

    it('focuses the field on a validation error and allows zero as a target', async () => {
      await mountSheet({ periodStart: '2026-10-01' });
      await click('[data-testid="target-open"]');
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
      await mountSheet({ periodStart: '2026-10-01' });
      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      await click('[data-testid="target-confirm"]');
      const calls = mocks.v2.updatePeriodTarget;
      expect(keyOf(calls, 0, 4)).toBe(keyOf(calls, 1, 4));

      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      expect(keyOf(calls, 2, 4)).not.toBe(keyOf(calls, 1, 4));

      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '200');
      await click('[data-testid="target-confirm"]');
      expect(keyOf(calls, 3, 4)).not.toBe(keyOf(calls, 2, 4));
    });

    it('target: a double submit makes one call', async () => {
      let release: (value: unknown) => void = () => undefined;
      mocks.v2.updatePeriodTarget.mockReturnValue(new Promise((resolve) => (release = resolve)));
      await mountSheet({ periodStart: '2026-10-01' });
      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      q<HTMLElement>('[data-testid="target-confirm"]')?.click();
      q<HTMLElement>('[data-testid="target-confirm"]')?.click();
      await flushPromises();
      expect(mocks.v2.updatePeriodTarget).toHaveBeenCalledTimes(1);
      release({});
      await flushPromises();
    });

    it('suggestion: retry keeps the key, later saves rotate it', async () => {
      mocks.v2.updateIncomeCategorySuggestion
        .mockRejectedValueOnce(new ApiRequestError(500, { code: 'X', detail: 'raw boom' }))
        .mockResolvedValue({});
      await mountSheet();
      await pick('[data-testid="suggestion-category"]', CATEGORY_ID);
      await click('[data-testid="suggestion-save"]');
      await click('[data-testid="suggestion-save"]');
      const calls = mocks.v2.updateIncomeCategorySuggestion;
      expect(keyOf(calls, 0, 2)).toBe(keyOf(calls, 1, 2));

      await click('[data-testid="suggestion-save"]');
      expect(keyOf(calls, 2, 2)).not.toBe(keyOf(calls, 1, 2));

      await click('[data-testid="suggestion-off"]');
      expect(keyOf(calls, 3, 2)).not.toBe(keyOf(calls, 2, 2));
    });

    it('suggestion: a double submit makes one call', async () => {
      let release: (value: unknown) => void = () => undefined;
      mocks.v2.updateIncomeCategorySuggestion.mockReturnValue(
        new Promise((resolve) => (release = resolve)),
      );
      await mountSheet();
      await pick('[data-testid="suggestion-category"]', CATEGORY_ID);
      q<HTMLElement>('[data-testid="suggestion-save"]')?.click();
      q<HTMLElement>('[data-testid="suggestion-save"]')?.click();
      await flushPromises();
      expect(mocks.v2.updateIncomeCategorySuggestion).toHaveBeenCalledTimes(1);
      release({});
      await flushPromises();
    });

    it('rule: the key rotates after success when the same values are saved again', async () => {
      await mountSheet();
      await click('[data-testid="rule-save"]');
      await click('[data-testid="rule-save"]');
      expect(keyOf(mocks.v2.updateFundingRule, 0, 3)).not.toBe(
        keyOf(mocks.v2.updateFundingRule, 1, 3),
      );
    });
  });

  describe('server errors', () => {
    it('shows server field errors for the target at the field', async () => {
      mocks.v2.updatePeriodTarget.mockRejectedValue(problem(400, 'target'));
      await mountSheet({ periodStart: '2026-10-01' });
      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      const error = q('[data-testid="target-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).not.toContain('raw english');
      expect(q('[data-testid="target-input"]')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(q('[data-testid="target-input"]'));
    });

    it('shows server field errors for the suggestion at the field', async () => {
      mocks.v2.updateIncomeCategorySuggestion.mockRejectedValue(problem(400, 'sourceCategoryId'));
      await mountSheet();
      await pick('[data-testid="suggestion-category"]', CATEGORY_ID);
      await click('[data-testid="suggestion-save"]');
      const error = q('[data-testid="suggestion-category-error"]');
      expect(error?.textContent).not.toContain('raw english');
      expect(q('[data-testid="suggestion-category"]')?.getAttribute('aria-invalid')).toBe('true');
    });

    it.each([
      [409, 'CONFLICT_X'],
      [500, 'BOOM'],
    ])('shows a Russian form error without the raw detail for %s', async (status, code) => {
      const failure = new ApiRequestError(status, { code, detail: 'raw technical detail' });
      mocks.v2.updateFundingRule.mockRejectedValue(failure);
      mocks.v2.updatePeriodTarget.mockRejectedValue(failure);
      mocks.v2.updateIncomeCategorySuggestion.mockRejectedValue(failure);
      await mountSheet({ periodStart: '2026-10-01' });

      await click('[data-testid="rule-save"]');
      await click('[data-testid="target-open"]');
      await type('[data-testid="target-input"]', '100');
      await click('[data-testid="target-confirm"]');
      await pick('[data-testid="suggestion-category"]', CATEGORY_ID);
      await click('[data-testid="suggestion-save"]');

      for (const id of ['rule-error', 'target-form-error', 'suggestion-error']) {
        const message = q(`[data-testid="${id}"]`)?.textContent ?? '';
        expect(message).toMatch(/[А-Яа-я]/);
        expect(message).not.toContain('raw technical detail');
      }
    });
  });

  it('offers a retry for a failed category load', async () => {
    mocks.reference.listCategories.mockRejectedValueOnce(new Error('down'));
    await mountSheet();
    expect(text()).not.toContain('Закройте панель');
    expect(q('[data-testid="categories-retry"]')).not.toBeNull();

    await click('[data-testid="categories-retry"]');
    expect(mocks.reference.listCategories).toHaveBeenCalledTimes(2);
    expect(q('[data-testid="categories-retry"]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="suggestion-category"] option').length).toBe(2);
  });
});
