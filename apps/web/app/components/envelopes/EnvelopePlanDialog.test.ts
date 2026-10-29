import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const BUDGET = '0190a000-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  v2: { getEnvelopeHistory: vi.fn() },
  role: { current: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => mocks.role.current) }),
}));

import EnvelopePlanDialog from './EnvelopePlanDialog.vue';

const ME = { userId: 'user-me', displayName: 'Я', isActiveMember: true };
const ILDAR = { userId: 'user-ildar', displayName: 'Ильдар', isActiveMember: true };

function envelope(id: string, name: string, overrides: Record<string, unknown> = {}) {
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
    owner: { ...ME },
    canEdit: true,
    ...overrides,
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
  mocks.role.current = 'OWNER';
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

  it('история: автор, сумма со знаком направления, контрагент', async () => {
    mocks.v2.getEnvelopeHistory.mockResolvedValue({
      items: [
        {
          kind: 'SPENDING',
          direction: 'OUT',
          amountMinor: '230000',
          effectiveOn: '2026-10-21',
          createdBy: { userId: 'u-aliya', displayName: 'Алия', isActiveMember: true },
          counterpartName: 'Детский мир',
          assignmentType: null,
        },
        {
          kind: 'MOVEMENT',
          direction: 'OUT',
          amountMinor: '100000',
          effectiveOn: '2026-10-21',
          createdBy: { ...ILDAR },
          counterpartName: 'Отпуск',
          assignmentType: null,
        },
      ],
      nextCursor: null,
    });
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const rows = document.querySelectorAll('[data-testid="plan-history"] li');
    expect(plain(rows[0]?.textContent ?? '')).toContain('Алия: −2 300,00');
    expect(plain(rows[0]?.textContent ?? '')).toContain('Детский мир');
    expect(rows[0]?.querySelector('.plan-dialog__kind-amount')?.className).not.toContain('--in');
    expect(plain(rows[1]?.textContent ?? '')).toContain('Ильдар: −1 000,00');
    expect(plain(rows[1]?.textContent ?? '')).toContain('→ Отпуск');
  });

  it('направление задаёт знак и цвет как дополнительный сигнал', async () => {
    mocks.v2.getEnvelopeHistory.mockResolvedValue({
      items: [
        {
          kind: 'MOVEMENT',
          direction: 'IN',
          amountMinor: '100000',
          effectiveOn: '2026-10-12',
          createdBy: { ...ILDAR },
          counterpartName: 'Детские расходы',
          assignmentType: null,
        },
        {
          kind: 'ASSIGNMENT',
          direction: 'IN',
          amountMinor: '1000000',
          effectiveOn: '2026-10-12',
          createdBy: { userId: 'u-ilya', displayName: null, isActiveMember: true },
          counterpartName: 'Зарплата',
          assignmentType: 'PERCENT',
        },
        {
          kind: 'MOVEMENT',
          direction: 'OUT',
          amountMinor: '100000',
          effectiveOn: '2026-10-12',
          createdBy: { userId: 'u-x', displayName: 'Марат', isActiveMember: false },
          counterpartName: 'Резерв',
          assignmentType: null,
        },
      ],
      nextCursor: null,
    });
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const rows = document.querySelectorAll('[data-testid="plan-history"] li');
    // Incoming movement names the counterpart as the source of the money.
    expect(plain(rows[0]?.textContent ?? '')).toContain('Ильдар: +1 000,00');
    expect(plain(rows[0]?.textContent ?? '')).toContain('← Детские расходы');
    expect(rows[0]?.querySelector('.plan-dialog__kind-amount')?.className).toContain('--in');
    // Income assignment reads "from <income>"; a missing name falls back to the fixed word.
    expect(plain(rows[1]?.textContent ?? '')).toContain('Участник: +10 000,00');
    expect(plain(rows[1]?.textContent ?? '')).toContain('из Зарплата');
    // A former family member keeps the "not in family" suffix.
    expect(plain(rows[2]?.textContent ?? '')).toContain('Марат (не в семье): −1 000,00');
  });

  it('история сгруппирована по дням в стиле OperationGroup', async () => {
    mocks.v2.getEnvelopeHistory.mockResolvedValue({
      items: [
        {
          kind: 'ASSIGNMENT',
          direction: 'IN',
          amountMinor: '1200000',
          effectiveOn: '2026-10-21',
          createdBy: { ...ILDAR },
          counterpartName: 'Зарплата',
          assignmentType: 'FIXED',
        },
        {
          kind: 'SPENDING',
          direction: 'OUT',
          amountMinor: '465000',
          effectiveOn: '2026-10-12',
          createdBy: { ...ME },
          counterpartName: 'Продукты',
          assignmentType: null,
        },
        {
          kind: 'SPENDING',
          direction: 'OUT',
          amountMinor: '150000',
          effectiveOn: '2026-10-12',
          createdBy: { ...ME },
          counterpartName: 'Кофе',
          assignmentType: null,
        },
      ],
      nextCursor: null,
    });
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const groups = document.querySelectorAll('[data-testid="plan-history"] .operation-group');
    expect(groups).toHaveLength(2);
    const labels = [...document.querySelectorAll('[data-testid="operation-group-label"]')].map(
      (el) => plain(el.textContent ?? '').trim(),
    );
    expect(labels[0]).toContain('21 октября');
    expect(labels[1]).toContain('12 октября');
    expect(groups[1]?.querySelectorAll('li')).toHaveLength(2);
    // The date now lives in the group header, not in every row.
    expect(groups[0]?.querySelectorAll('time')).toHaveLength(0);
  });

  it('история прокручивается внутри диалога и доступна с клавиатуры', async () => {
    mocks.v2.getEnvelopeHistory.mockResolvedValue({
      items: [{ kind: 'ASSIGNMENT', amountMinor: '1200000', effectiveOn: '2026-10-21' }],
      nextCursor: null,
    });
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    const list = document.querySelector('[data-testid="plan-history-list"]');
    expect(list?.classList.contains('hf-scroll')).toBe(true);
    expect(list?.getAttribute('tabindex')).toBe('0');
    expect(list?.getAttribute('aria-label')).toBe('История конверта');
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

  it('чужой конверт (canEdit false): нет управляющих действий, видна подпись владельца', async () => {
    // Even an editor sees a family member's envelope read-only — ownership, not role, gates it.
    await mountDialog({
      envelope: envelope('env-a', 'Еда', { canEdit: false, owner: { ...ILDAR } }),
    });

    expect(document.querySelector('[data-testid="plan-dialog-reassign"]')).toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-target"]')).toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-edit"]')).toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-archive"]')).toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-operations"]')).not.toBeNull();
    expect(plain(document.body.textContent ?? '')).toContain(
      'Принадлежит участнику «Ильдар» — изменять может только владелец',
    );
  });

  it('чтение доступно всем, действия своего конверта — владельцу', async () => {
    await mountDialog({ envelope: envelope('env-a', 'Еда') });

    // The server's envelope history endpoint has no role check, so every role sees the toggle.
    expect(document.querySelector('[data-testid="history-toggle-deleted"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-reassign"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plan-dialog-edit"]')).not.toBeNull();
    expect(plain(document.body.textContent ?? '')).not.toContain('Принадлежит участнику');
  });
});
