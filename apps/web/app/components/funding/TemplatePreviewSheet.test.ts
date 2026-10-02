import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

const BUDGET = '0190a000-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  v2: { getTemplatePreview: vi.fn(), applyTemplate: vi.fn() },
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));

import TemplatePreviewSheet from './TemplatePreviewSheet.vue';
import { useFundingEntry } from '../../composables/useFundingEntry.js';

const match = {
  matchedBy: null,
  existingId: null,
  existingName: null,
  archivedId: null,
  collisionId: null,
  suggestedAction: 'CREATE',
  requiresConsent: false,
};

function envelope(
  role: string,
  templateKey: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...match,
    status: 'MISSING',
    role,
    templateKey,
    name,
    type: role === 'SAVINGS' ? 'SAVINGS_GOAL' : 'CURRENT_EXPENSES',
    periodSlot: role === 'FIRST' || role === 'SECOND' ? role : null,
    selectable: role === 'SAVINGS',
    suggestedRuleType: 'MANUAL',
    existingRuleType: null,
    suggestedTargetMinor: null,
    replacementTemplateKey: null,
    ...overrides,
  };
}

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    cycle: {
      ...match,
      status: 'EXISTING',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
      suggestedAction: 'ADOPT',
    },
    categories: [
      {
        ...match,
        status: 'MISSING',
        templateKey: 'expense-groceries',
        name: 'Продукты',
        categoryType: 'EXPENSE',
        parentTemplateKey: null,
      },
    ],
    envelopes: [
      envelope('FIRST', 'v2-period-first', 'Первый период'),
      envelope('SECOND', 'v2-period-second', 'Второй период'),
      envelope('MANDATORY', 'v2-mandatory', 'Обязательные'),
      envelope('SAVINGS', 'v2-savings-car', 'Автомобиль'),
      envelope('SAVINGS', 'v2-savings-vacation', 'Отпуск'),
    ],
    isComplete: false,
    previewHash: 'a'.repeat(64),
    ...overrides,
  };
}

const wrappers: Array<{ unmount: () => void }> = [];
async function mountSheet() {
  const wrapper = mount(TemplatePreviewSheet, {
    props: { open: true, budgetId: BUDGET },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
async function click(selector: string) {
  q<HTMLElement>(selector)?.click();
  await flushPromises();
}
async function type(selector: string, value: string) {
  const input = q<HTMLInputElement>(selector);
  if (!input) throw new Error(`missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

function applyBody(): Record<string, unknown> {
  return mocks.v2.applyTemplate.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}
function applyKey(index = -1): string {
  return mocks.v2.applyTemplate.mock.calls.at(index)?.[2] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentData.value = {
    user: { id: 'u', email: 'o@example.test', displayName: null },
    workspaces: [
      {
        id: 'w',
        name: 'Семья',
        role: 'OWNER',
        budgets: [{ id: BUDGET, name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: 2 }],
      },
    ],
  };
  mocks.v2.getTemplatePreview.mockResolvedValue(previewBody());
  mocks.v2.applyTemplate.mockResolvedValue({
    created: { categories: [], envelopes: [] },
    adopted: [],
    skipped: [],
    rules: [],
    cycle: { changed: false, resetPeriods: 0 },
    isComplete: true,
    previewHash: 'b'.repeat(64),
  });
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('TemplatePreviewSheet', () => {
  it('loads the v2 preview and shows optional targets without defaults', async () => {
    await mountSheet();

    expect(mocks.v2.getTemplatePreview).toHaveBeenCalledWith(BUDGET);
    expect(text()).toContain('Укажу позже');
    expect(text()).toContain('Первый период');
    expect(text()).toContain('Второй период');
    expect(text()).toContain('Обязательные');
    expect(q<HTMLInputElement>('[data-testid="template-target-FIRST"]')?.value).toBe('');
    expect(q<HTMLInputElement>('[data-testid="template-target-SECOND"]')?.value).toBe('');
    expect(text()).not.toMatch(/65\s?000|20\s?000/);
    expect(text()).not.toContain('Свободные');
    expect(text()).toContain('Цикл');
    expect(text()).toContain('отдельно');
  });

  it('never selects savings by default', async () => {
    await mountSheet();

    const boxes = document.querySelectorAll<HTMLInputElement>('[data-testid^="template-savings-"]');
    expect(boxes.length).toBe(2);
    boxes.forEach((box) => expect(box.checked).toBe(false));

    await click('[data-testid="template-apply"]');
    expect(applyBody()['savings']).toEqual([]);
  });

  it('shows element statuses as text, not only color', async () => {
    mocks.v2.getTemplatePreview.mockResolvedValue(
      previewBody({
        envelopes: [
          envelope('FIRST', 'v2-period-first', 'Первый период', {
            status: 'EXISTING',
            existingId: 'e1',
            existingName: 'Первый период',
            suggestedAction: 'ADOPT',
          }),
          envelope('SECOND', 'v2-period-second', 'Второй период', {
            status: 'COLLISION',
            collisionId: 'c1',
            suggestedAction: 'SKIP',
          }),
          envelope('MANDATORY', 'v2-mandatory', 'Обязательные', {
            status: 'ARCHIVED',
            archivedId: 'a1',
            requiresConsent: true,
            replacementTemplateKey: 'v2-replacement-mandatory-a1',
          }),
          envelope('SAVINGS', 'v2-savings-car', 'Автомобиль'),
        ],
      }),
    );
    await mountSheet();

    expect(text()).toContain('Уже есть');
    expect(text()).toContain('Конфликт');
    expect(text()).toContain('В архиве, не восстанавливается');
    expect(text()).toContain('Будет создан');
  });

  it('leaves an archived element and a conflict untouched without consent', async () => {
    mocks.v2.getTemplatePreview.mockResolvedValue(
      previewBody({
        envelopes: [
          envelope('FIRST', 'v2-period-first', 'Первый период', {
            status: 'COLLISION',
            suggestedAction: 'SKIP',
          }),
          envelope('SECOND', 'v2-period-second', 'Второй период'),
          envelope('MANDATORY', 'v2-mandatory', 'Обязательные', {
            status: 'ARCHIVED',
            requiresConsent: true,
          }),
        ],
      }),
    );
    await mountSheet();
    await click('[data-testid="template-apply"]');

    expect(applyBody()['periods']).toEqual([
      { role: 'FIRST', action: 'SKIP' },
      { role: 'SECOND', action: 'CREATE' },
    ]);
    expect(applyBody()['mandatory']).toEqual({ action: 'SKIP' });

    await click('[data-testid="template-consent-MANDATORY"]');
    await click('[data-testid="template-apply"]');
    expect(applyBody()['mandatory']).toEqual({ action: 'CREATE' });
  });

  it('sends previewHash, an Idempotency-Key and decimal strings on apply', async () => {
    const wrapper = await mountSheet();
    await type('[data-testid="template-target-FIRST"]', '12000,50');
    await click('[data-testid="template-savings-v2-savings-car"]');
    await type('[data-testid="template-contribution-v2-savings-car"]', '5000');
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.v2.applyTemplate.mock.calls[0]?.[0]).toBe(BUDGET);
    expect(applyBody()).toEqual({
      previewHash: 'a'.repeat(64),
      periods: [
        { role: 'FIRST', action: 'CREATE', target: '12000.50' },
        { role: 'SECOND', action: 'CREATE' },
      ],
      mandatory: { action: 'CREATE' },
      savings: [{ name: 'Автомобиль', requestedContribution: '5000' }],
    });
    expect(applyKey()).toMatch(/\S+/);
    expect(wrapper.emitted('applied')).toHaveLength(1);
  });

  it('marks the v2 data as changed after a successful apply', async () => {
    const before = useFundingEntry().confirmedCount.value;
    await mountSheet();
    await click('[data-testid="template-apply"]');

    expect(useFundingEntry().confirmedCount.value).toBe(before + 1);
  });

  it('shows field errors for invalid amounts and does not call the API', async () => {
    await mountSheet();
    await type('[data-testid="template-target-FIRST"]', '12abc');
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).not.toHaveBeenCalled();
    expect(text()).toContain('Проверьте введённые суммы');
    expect(q('[data-testid="template-target-FIRST"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(q('[data-testid="template-error-FIRST"]')).not.toBeNull();
  });

  it('keeps the same key when a failed attempt is retried and rotates it on new input', async () => {
    mocks.v2.applyTemplate.mockRejectedValueOnce(new TypeError('network'));
    await mountSheet();
    await click('[data-testid="template-apply"]');
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).toHaveBeenCalledTimes(2);
    expect(applyKey(0)).toBe(applyKey(1));

    mocks.v2.applyTemplate.mockRejectedValueOnce(new TypeError('network'));
    await type('[data-testid="template-target-SECOND"]', '100');
    await click('[data-testid="template-apply"]');
    expect(applyKey(2)).not.toBe(applyKey(1));
  });

  it('offers a refresh on PREVIEW_STALE and re-requests the preview', async () => {
    mocks.v2.applyTemplate.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'PREVIEW_STALE', detail: 'raw' }),
    );
    await mountSheet();
    await click('[data-testid="template-apply"]');

    expect(text()).toContain('Данные изменились');
    expect(mocks.v2.getTemplatePreview).toHaveBeenCalledTimes(1);

    await click('[data-testid="template-refresh"]');
    expect(mocks.v2.getTemplatePreview).toHaveBeenCalledTimes(2);
    expect(q('[data-testid="template-refresh"]')).toBeNull();
  });

  it('reports a load failure in Russian with a retry', async () => {
    mocks.v2.getTemplatePreview.mockRejectedValueOnce(new TypeError('network'));
    await mountSheet();

    expect(text()).toContain('Не удалось загрузить шаблон');
    await click('[data-testid="template-retry"]');
    expect(mocks.v2.getTemplatePreview).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Первый период');
  });
});

type PeriodBody = Array<{ role: string }>;
const periodOf = (role: string) =>
  (applyBody()['periods'] as PeriodBody).find((item) => item.role === role);

describe('TemplatePreviewSheet review fixes', () => {
  it('submits once on a double click and blocks Cancel while pending', async () => {
    let finish: (() => void) | undefined;
    mocks.v2.applyTemplate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              created: { categories: [], envelopes: [] },
              adopted: [],
              skipped: [],
              rules: [],
              cycle: { changed: false, resetPeriods: 0 },
              isComplete: true,
              previewHash: 'b'.repeat(64),
            });
        }),
    );
    const wrapper = await mountSheet();
    await click('[data-testid="template-apply"]');
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="template-cancel"]')?.hasAttribute('disabled')).toBe(true);
    finish?.();
    await flushPromises();
    expect(wrapper.emitted('applied')).toHaveLength(1);
  });

  it('uses the new previewHash and a new key after a stale refresh', async () => {
    mocks.v2.applyTemplate.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'PREVIEW_STALE', detail: 'raw' }),
    );
    await mountSheet();
    await click('[data-testid="template-apply"]');
    const firstKey = applyKey();
    mocks.v2.getTemplatePreview.mockResolvedValueOnce(previewBody({ previewHash: 'c'.repeat(64) }));
    await click('[data-testid="template-refresh"]');
    await click('[data-testid="template-apply"]');

    expect(applyBody()['previewHash']).toBe('c'.repeat(64));
    expect(applyKey()).not.toBe(firstKey);
  });

  it.each(['FIRST', 'SECOND'] as const)(
    'creates a new archived %s period only with consent, with or without a target',
    async (role) => {
      const other = role === 'FIRST' ? 'SECOND' : 'FIRST';
      mocks.v2.getTemplatePreview.mockResolvedValue(
        previewBody({
          envelopes: [
            envelope(role, `v2-period-${role.toLowerCase()}`, 'Период', {
              status: 'ARCHIVED',
              requiresConsent: true,
            }),
            envelope(other, `v2-period-${other.toLowerCase()}`, 'Другой'),
            envelope('MANDATORY', 'v2-mandatory', 'Обязательные'),
          ],
        }),
      );
      await mountSheet();
      expect(q(`[data-testid="template-target-${role}"]`)).toBeNull();
      await click('[data-testid="template-apply"]');
      expect(periodOf(role)).toEqual({ role, action: 'SKIP' });

      await click(`[data-testid="template-consent-${role}"]`);
      await click('[data-testid="template-apply"]');
      expect(periodOf(role)).toEqual({ role, action: 'CREATE' });

      await type(`[data-testid="template-target-${role}"]`, '300');
      await click('[data-testid="template-apply"]');
      expect(periodOf(role)).toEqual({ role, action: 'CREATE', target: '300' });
    },
  );

  it('disables archived and conflicting savings', async () => {
    mocks.v2.getTemplatePreview.mockResolvedValue(
      previewBody({
        envelopes: [
          envelope('FIRST', 'v2-period-first', 'Первый период'),
          envelope('SECOND', 'v2-period-second', 'Второй период'),
          envelope('MANDATORY', 'v2-mandatory', 'Обязательные'),
          envelope('SAVINGS', 'v2-savings-car', 'Автомобиль', { status: 'ARCHIVED' }),
          envelope('SAVINGS', 'v2-savings-vacation', 'Отпуск', { status: 'COLLISION' }),
        ],
      }),
    );
    await mountSheet();

    const car = q<HTMLInputElement>('[data-testid="template-savings-v2-savings-car"]');
    const vacation = q<HTMLInputElement>('[data-testid="template-savings-v2-savings-vacation"]');
    expect(car?.disabled).toBe(true);
    expect(vacation?.disabled).toBe(true);
  });

  it.each(['0', '0,00', '10.123', '-5'])('rejects target "%s"', async (value) => {
    await mountSheet();
    await type('[data-testid="template-target-FIRST"]', value);
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).not.toHaveBeenCalled();
    expect(q('[data-testid="template-error-FIRST"]')).not.toBeNull();
  });

  it('rejects an invalid savings contribution and focuses the first invalid field', async () => {
    await mountSheet();
    await click('[data-testid="template-savings-v2-savings-car"]');
    await type('[data-testid="template-contribution-v2-savings-car"]', 'abc');
    await click('[data-testid="template-apply"]');

    expect(mocks.v2.applyTemplate).not.toHaveBeenCalled();
    expect(q('[data-testid="template-error-v2-savings-car"]')).not.toBeNull();
    expect(document.activeElement).toBe(q('[data-testid="template-contribution-v2-savings-car"]'));
  });

  it('clears a typed target when "Укажу позже" is checked', async () => {
    await mountSheet();
    await type('[data-testid="template-target-FIRST"]', '500');
    expect(q<HTMLInputElement>('[data-testid="template-later-FIRST"]')?.checked).toBe(false);
    await click('[data-testid="template-later-FIRST"]');

    expect(q<HTMLInputElement>('[data-testid="template-target-FIRST"]')?.value).toBe('');
    await click('[data-testid="template-apply"]');
    expect(periodOf('FIRST')).toEqual({ role: 'FIRST', action: 'CREATE' });
  });

  it('drops a selected saving that became archived after a refresh', async () => {
    mocks.v2.applyTemplate.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'PREVIEW_STALE', detail: 'raw' }),
    );
    await mountSheet();
    await click('[data-testid="template-savings-v2-savings-car"]');
    await click('[data-testid="template-apply"]');
    mocks.v2.getTemplatePreview.mockResolvedValueOnce(
      previewBody({
        previewHash: 'd'.repeat(64),
        envelopes: [
          envelope('FIRST', 'v2-period-first', 'Первый период'),
          envelope('SECOND', 'v2-period-second', 'Второй период'),
          envelope('MANDATORY', 'v2-mandatory', 'Обязательные'),
          envelope('SAVINGS', 'v2-savings-car', 'Автомобиль', { status: 'ARCHIVED' }),
        ],
      }),
    );
    await click('[data-testid="template-refresh"]');
    await click('[data-testid="template-apply"]');

    expect(applyBody()['savings']).toEqual([]);
  });

  it('shows Russian text for template conflict codes', async () => {
    mocks.v2.applyTemplate.mockRejectedValueOnce(
      new ApiRequestError(409, { code: 'TEMPLATE_NAME_CONFLICT', detail: 'raw english' }),
    );
    await mountSheet();
    await click('[data-testid="template-apply"]');

    expect(text()).not.toContain('raw english');
    expect(text()).toContain('Имя элемента');
    expect(text()).not.toContain('Не удалось применить шаблон');
  });
});
