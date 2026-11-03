import { describe, expect, it } from 'vitest';

import { TelegramBotViews, type BotReaders } from './telegram-bot-views.js';
import type { BotContext } from './telegram-command.service.js';

const NBSP = '\u00a0';

const ctx: BotContext = {
  chatId: 1n,
  userId: 'user-1',
  budgetId: 'budget-1',
  budgetName: 'Семья',
  timezone: 'Europe/Moscow',
  role: 'OWNER',
  today: '2026-11-03',
};

/** One calendar month with an overdue obligation and a pending income plan. */
function fakeReaders(): BotReaders {
  const viewers = [
    {
      month: '2026-11',
      overdue: [
        {
          occurrenceId: 'o1',
          kind: 'OBLIGATION',
          name: 'Аренда',
          scheduledOn: '2026-10-28',
          status: 'OVERDUE',
          expectedMinor: '3000000',
          unpaidMinor: '3000000',
          overdue: true,
        },
      ],
      items: [
        {
          occurrenceId: 'i1',
          kind: 'INCOME_PLAN',
          name: 'Зарплата',
          scheduledOn: '2026-11-05',
          status: 'PENDING',
          // The real incomeItem() always reports unpaidMinor '0'.
          expectedMinor: '8000000',
          unpaidMinor: '0',
          overdue: false,
        },
      ],
    },
  ];
  let call = 0;
  return {
    plans: {
      calendar: async () => {
        const view = viewers[call];
        call += 1;
        return view as unknown as Awaited<ReturnType<BotReaders['plans']['calendar']>>;
      },
    },
  } as unknown as BotReaders;
}

describe('TelegramBotViews /plans amounts', () => {
  it('prints the expected amount for income plans and the unpaid remainder for obligations', async () => {
    const views = new TelegramBotViews(
      fakeReaders(),
      {
        accountNames: async () => new Map(),
        categoryNames: async () => new Map(),
      },
      '',
    );
    const screen = await views.render('plans', ctx);
    if (!screen) throw new Error('plans must render a screen');
    expect(screen.text).toContain(`−30${NBSP}000${NBSP}₽`);
    expect(screen.text).toContain(`+80${NBSP}000${NBSP}₽`);
    expect(screen.text).not.toContain(`+0${NBSP}`);
  });
});
