import { describe, expect, it } from 'vitest';

import { urgentContentOf } from './urgent-content.js';

const overdue = {
  notificationType: 'PLAN_OVERDUE' as const,
  title: 'Просроченный план',
  body: 'План «Ипотека» просрочен с 2026-10-25.',
  actionPath: '/app/plans?occurrence=occ-1',
  occurrence: { planName: 'Ипотека', amountMinor: 4_500_000n },
  budget: { primaryCurrency: 'RUB' },
};

describe('urgentContentOf', () => {
  it('shows no amount without consent', () => {
    const content = urgentContentOf(overdue, false)!;
    expect(content.subject).toBe('Просрочен платёж «Ипотека»');
    expect(content.lines).toEqual(['План «Ипотека» просрочен с 2026-10-25.']);
    expect(JSON.stringify(content)).not.toMatch(/45/);
  });

  it('adds the planned amount with consent', () => {
    expect(urgentContentOf(overdue, true)!.lines[1]).toMatch(/^Сумма по плану: 45\s000,00\s₽\.$/u);
  });

  it('builds a calendar reminder', () => {
    expect(
      urgentContentOf(
        {
          ...overdue,
          notificationType: 'CALENDAR_REMINDER',
          title: 'Родительское собрание',
          body: 'Сегодня в 18:00.',
          occurrence: null,
        },
        true,
      ),
    ).toEqual({
      subject: 'Напоминание: «Родительское собрание»',
      lines: ['Сегодня в 18:00.'],
      actionPath: '/app/plans?occurrence=occ-1',
    });
  });

  it('ignores other notification types', () => {
    expect(urgentContentOf({ ...overdue, notificationType: 'PLAN_TODAY' }, true)).toBeNull();
  });
});
