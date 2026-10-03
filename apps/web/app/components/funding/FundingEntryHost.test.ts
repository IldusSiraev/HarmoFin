import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { ApiRequestError } from '../../composables/useApiClient.js';

const BUDGET = '0190a000-0000-7000-8000-000000000001';
const INCOME = '0190a000-0000-7000-8000-0000000000aa';
const ENV = '0190a000-0000-7000-8000-0000000000e1';
const PERIOD = '0190a000-0000-7000-8000-0000000000b1';

const mocks = vi.hoisted(() => ({
  v2: { previewFunding: vi.fn(), confirmFunding: vi.fn() },
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  reference: { load: vi.fn() },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useOperationReferenceData.js', () => ({
  useOperationReferenceData: () => ({
    load: mocks.reference.load,
    envelopePlans: ref([{ id: ENV, name: 'Обязательные' }]),
  }),
}));

import FundingEntryHost from './FundingEntryHost.vue';
import { useFundingEntry } from '../../composables/useFundingEntry.js';

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceKind: 'INCOME',
    sourceAvailableMinor: '1000000',
    periodTargetDrafts: [
      { periodId: PERIOD, targetMinor: '500000', selectedForConfirmation: true },
    ],
    lines: [{ envelopeId: ENV, periodId: null, suggestedMinor: '400050' }],
    remainingMinor: '599950',
    mandatoryGapMinor: '0',
    previewHash: 'hash-1',
    errors: [],
    ...overrides,
  };
}

function setBudgetVersion(version: 1 | 2): void {
  mocks.auth.currentData.value = {
    user: { id: 'u', email: 'o@example.test', displayName: null },
    workspaces: [
      {
        id: 'w',
        name: 'Семья',
        role: 'OWNER',
        budgets: [
          { id: BUDGET, name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: version },
        ],
      },
    ],
  };
}

const wrappers: Array<{ unmount: () => void }> = [];
function mountHost() {
  const wrapper = mount(FundingEntryHost, { attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}

function click(testId: string): void {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
}

beforeEach(() => {
  vi.clearAllMocks();
  setBudgetVersion(2);
  useFundingEntry().dismiss();
  mocks.reference.load.mockResolvedValue(undefined);
  mocks.v2.previewFunding.mockResolvedValue(previewBody());
  mocks.v2.confirmFunding.mockResolvedValue({
    assignedMinor: '400050',
    sourceRemainingMinor: '599950',
    confirmedPeriodIds: [PERIOD],
    assignments: [],
  });
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('FundingEntryHost', () => {
  it('previews an income source on the server and opens the sheet', async () => {
    const wrapper = mountHost();

    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    expect(mocks.v2.previewFunding).toHaveBeenNthCalledWith(1, BUDGET, {
      sourceKind: 'INCOME',
      incomeTransactionId: INCOME,
    });
    expect(wrapper.find('[data-testid="funding-source"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Обязательные');
  });

  it('previews an opening source after an account is created', async () => {
    mountHost();

    useFundingEntry().offer({ sourceKind: 'OPENING' });
    await flushPromises();

    expect(mocks.v2.previewFunding).toHaveBeenCalledWith(
      BUDGET,
      expect.objectContaining({ sourceKind: 'OPENING' }),
    );
  });

  it('closes on Later without confirming anything', async () => {
    const wrapper = mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    click('funding-later');
    await flushPromises();

    expect(mocks.v2.confirmFunding).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="funding-source"]').exists()).toBe(false);
  });

  it('confirms the same lines, targets and hash with one Idempotency-Key, stable on retry', async () => {
    const wrapper = mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    mocks.v2.confirmFunding.mockRejectedValueOnce(new TypeError('network'));

    click('funding-confirm');
    await flushPromises();
    click('funding-confirm');
    await flushPromises();

    expect(mocks.v2.confirmFunding).toHaveBeenCalledTimes(2);
    const [budget, body, key] = mocks.v2.confirmFunding.mock.calls[0] as [string, unknown, string];
    expect(budget).toBe(BUDGET);
    expect(body).toEqual({
      sourceKind: 'INCOME',
      incomeTransactionId: INCOME,
      previewHash: 'hash-1',
      confirmPeriodTargets: [PERIOD],
      lines: [{ envelopeId: ENV, amount: '4000.50' }],
    });
    expect(typeof key).toBe('string');
    expect(mocks.v2.confirmFunding.mock.calls[1]?.[2]).toBe(key);
    expect(wrapper.emitted('confirmed')).toHaveLength(1);
  });

  it('previews with overrides equal to the confirmed lines so the hash matches', async () => {
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    expect(mocks.v2.previewFunding).toHaveBeenLastCalledWith(BUDGET, {
      sourceKind: 'INCOME',
      incomeTransactionId: INCOME,
      overrides: [{ envelopeId: ENV, amount: '4000.50' }],
      confirmPeriodTargets: [PERIOD],
    });
  });

  it('re-previews on the server with decimal overrides when a line changes and rotates the key', async () => {
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    mocks.v2.confirmFunding.mockRejectedValueOnce(new TypeError('network'));
    click('funding-confirm');
    await flushPromises();
    const firstKey = mocks.v2.confirmFunding.mock.calls[0]?.[2] as string;

    mocks.v2.previewFunding.mockResolvedValue(
      previewBody({
        lines: [{ envelopeId: ENV, periodId: null, suggestedMinor: '250000' }],
        remainingMinor: '750000',
        previewHash: 'hash-2',
      }),
    );
    const input = document.querySelector<HTMLInputElement>(`[data-testid="funding-amount-${ENV}"]`);
    input!.value = '2500';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(mocks.v2.previewFunding).toHaveBeenLastCalledWith(BUDGET, {
      sourceKind: 'INCOME',
      incomeTransactionId: INCOME,
      overrides: [{ envelopeId: ENV, amount: '2500' }],
      confirmPeriodTargets: [PERIOD],
    });
    click('funding-confirm');
    await flushPromises();
    const second = mocks.v2.confirmFunding.mock.calls[1] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(second[1]).toMatchObject({
      previewHash: 'hash-2',
      lines: [{ envelopeId: ENV, amount: '2500.00' }],
    });
    expect(second[2]).not.toBe(firstKey);
  });

  it('shows Refresh on PREVIEW_STALE and refresh requests a new preview', async () => {
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    mocks.v2.confirmFunding.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'PREVIEW_STALE', detail: 'stale' }),
    );

    click('funding-confirm');
    await flushPromises();
    expect(document.querySelector('[data-testid="funding-stale"]')).not.toBeNull();
    expect(mocks.v2.confirmFunding).toHaveBeenCalledTimes(1);
    const previewsBefore = mocks.v2.previewFunding.mock.calls.length;

    click('funding-refresh');
    await flushPromises();

    expect(mocks.v2.previewFunding.mock.calls.length).toBeGreaterThan(previewsBefore);
    expect(mocks.v2.confirmFunding).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="funding-stale"]')).toBeNull();
  });

  it('stays quiet when an opening preview is not available', async () => {
    const wrapper = mountHost();
    mocks.v2.previewFunding.mockRejectedValue(
      new ApiRequestError(422, { code: 'OPENING_NOT_AVAILABLE', detail: 'no' }),
    );

    useFundingEntry().offer({ sourceKind: 'OPENING' });
    await flushPromises();

    expect(wrapper.find('[data-testid="funding-source"]').exists()).toBe(false);
  });
  it('sends one confirm for a double click and reports one confirmed', async () => {
    const wrapper = mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    mocks.v2.confirmFunding.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    click('funding-confirm');
    click('funding-confirm');
    await flushPromises();
    expect(mocks.v2.confirmFunding).toHaveBeenCalledTimes(1);
    resolve({
      assignedMinor: '1',
      sourceRemainingMinor: '0',
      confirmedPeriodIds: [],
      assignments: [],
    });
    await flushPromises();

    expect(wrapper.emitted('confirmed')).toHaveLength(1);
  });

  it('does not lose a confirmed result when a new offer arrives while confirm is in flight', async () => {
    const wrapper = mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    const before = useFundingEntry().confirmedCount.value;
    let resolve!: (value: unknown) => void;
    mocks.v2.confirmFunding.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    click('funding-confirm');
    await flushPromises();
    useFundingEntry().offer({ sourceKind: 'OPENING' });
    await flushPromises();
    resolve({
      assignedMinor: '1',
      sourceRemainingMinor: '0',
      confirmedPeriodIds: [],
      assignments: [],
    });
    await flushPromises();

    expect(useFundingEntry().confirmedCount.value).toBe(before + 1);
    expect(wrapper.emitted('confirmed')).toHaveLength(1);
  });

  it('ignores Later while confirm is in flight', async () => {
    const wrapper = mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();
    let resolve!: (value: unknown) => void;
    mocks.v2.confirmFunding.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    click('funding-confirm');
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="funding-source"]').exists()).toBe(true);

    resolve({
      assignedMinor: '1',
      sourceRemainingMinor: '0',
      confirmedPeriodIds: [],
      assignments: [],
    });
    await flushPromises();
    expect(wrapper.emitted('confirmed')).toHaveLength(1);
  });

  it('shows Russian text for known error codes and a generic fallback for unknown ones', async () => {
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    mocks.v2.confirmFunding.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'SOURCE_EXHAUSTED', detail: 'raw english detail' }),
    );
    click('funding-confirm');
    await flushPromises();
    const known = document.querySelector('[data-testid="funding-error"]')?.textContent ?? '';
    expect(known).not.toContain('raw english detail');
    expect(known).toMatch(/[а-яё]/i);

    mocks.v2.previewFunding.mockResolvedValue(previewBody());
    click('funding-confirm');
    mocks.v2.confirmFunding.mockRejectedValueOnce(
      new ApiRequestError(422, { code: 'SOMETHING_NEW', detail: 'raw detail two' }),
    );
    // error disables confirm; a new preview (edit) clears it first
    const input = document.querySelector<HTMLInputElement>(`[data-testid="funding-amount-${ENV}"]`);
    input!.value = '10';
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    click('funding-confirm');
    await flushPromises();
    const fallback = document.querySelector('[data-testid="funding-error"]')?.textContent ?? '';
    expect(fallback).not.toContain('raw detail two');
    expect(fallback).toContain('Не удалось');
  });

  it('returns focus to the page when the opener has disappeared', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    click('funding-later');
    await flushPromises();

    expect(document.activeElement).toBe(main);
  });
});
