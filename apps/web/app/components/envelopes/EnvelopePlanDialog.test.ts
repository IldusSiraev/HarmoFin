import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUDGET = '0190a000-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  v2: { getEnvelopeHistory: vi.fn() },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));

import EnvelopePlanDialog from './EnvelopePlanDialog.vue';

function envelope(id: string, name: string) {
  return {
    id,
    name,
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '100',
    spentMinor: '0',
    balanceMinor: '100',
    archivedAt: null,
  };
}

const plain = (value: string): string => value.replace(/\s/g, ' ');

const wrappers: Array<{ unmount: () => void }> = [];
async function mountDialog(props: Record<string, unknown>) {
  const wrapper = mount(EnvelopePlanDialog, {
    props: { budgetId: BUDGET, ruleSummary: null, badge: null, ...props } as never,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.getEnvelopeHistory.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('EnvelopePlanDialog: статус и история', () => {
  it('крупная сумма и статус «Конверт в порядке» без метки', async () => {
    await mountDialog({ envelope: envelope('env-a', 'Еда'), badge: null });

    expect(document.querySelector('[data-testid="plan-dialog-status"]')?.textContent?.trim()).toBe(
      'Конверт в порядке',
    );
  });

  it('перерасход — статус danger', async () => {
    await mountDialog({
      envelope: envelope('env-a', 'Еда'),
      badge: { tone: 'danger', text: 'Перерасход 1 000,00 ₽' },
    });

    const status = document.querySelector('[data-testid="plan-dialog-status"]');
    expect(status?.textContent).toContain('Перерасход');
    expect(status?.className).toContain('--danger');
  });

  it('история: знак суммы по виду записи', async () => {
    mocks.v2.getEnvelopeHistory.mockResolvedValue({
      items: [
        { kind: 'ASSIGNMENT', amountMinor: '1200000', effectiveOn: '2026-10-21' },
        { kind: 'SPENDING', amountMinor: '465000', effectiveOn: '2026-10-12' },
        { kind: 'MOVEMENT', amountMinor: '700000', effectiveOn: '2026-10-10' },
      ],
      nextCursor: null,
    });
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const rows = document.querySelectorAll('[data-testid="plan-history"] li');
    expect(plain(rows[0]?.textContent ?? '')).toContain('+12 000,00');
    expect(rows[0]?.querySelector('.plan-dialog__kind-amount')?.className).toContain('--in');
    expect(plain(rows[1]?.textContent ?? '')).toContain('−4 650,00');
    expect(rows[1]?.querySelector('.plan-dialog__kind-amount')?.className).not.toContain('--in');
    // Movement direction relative to this envelope is unknown: no sign, neutral colour.
    expect(plain(rows[2]?.textContent ?? '')).toContain('7 000,00');
    expect(plain(rows[2]?.textContent ?? '')).not.toContain('+7 000,00');
    expect(plain(rows[2]?.textContent ?? '')).not.toContain('−7 000,00');
    expect(rows[2]?.querySelector('.plan-dialog__kind-amount')?.className).not.toContain('--in');
  });

  it('архивный конверт — статус «В архиве» раньше бейджа', async () => {
    await mountDialog({
      envelope: { ...envelope('env-a', 'Еда'), archivedAt: '2026-09-01T00:00:00.000Z' },
      badge: { tone: 'danger', text: 'Перерасход 1 000,00 ₽' },
    });

    const status = document.querySelector('[data-testid="plan-dialog-status"]');
    expect(status?.textContent?.trim()).toBe('В архиве');
    expect(status?.className).toContain('--neutral');
  });

  it('переключатель отменённых: подпись постоянна, состояние — через aria-checked', async () => {
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="history-toggle-deleted"]',
    );
    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.textContent?.trim()).toBe('Показать отменённые записи');

    toggle?.click();
    await flushPromises();

    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(toggle?.textContent?.trim()).toBe('Показать отменённые записи');
    expect(mocks.v2.getEnvelopeHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: 'DELETED' }),
    );
  });
});
