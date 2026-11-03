import { describe, expect, it } from 'vitest';

import { renderBalance, renderEvents, renderLast, renderPlans } from './bot-views.js';

const today = '2026-11-03';
const NBSP = '\u00a0';
const person = (displayName: string | null) => ({
  userId: 'u',
  displayName,
  isActiveMember: true,
});

describe('renderLast', () => {
  it('lists signed amounts with names, transfers with both accounts, and the author', () => {
    const text = renderLast(
      [
        {
          kind: 'TRANSACTION',
          transactionType: 'EXPENSE',
          amountMinor: '125050',
          occurredOn: '2026-11-02',
          accountId: 'a1',
          categoryId: 'c1',
          createdBy: person('Анна'),
        },
        {
          kind: 'TRANSACTION',
          transactionType: 'INCOME',
          amountMinor: '8000000',
          occurredOn: '2026-11-01',
          accountId: 'a1',
          categoryId: 'c2',
          createdBy: person(null),
        },
        {
          kind: 'TRANSFER',
          amountMinor: '500000',
          occurredOn: '2026-11-01',
          sourceAccountId: 'a1',
          destinationAccountId: 'a2',
          createdBy: person('Борис'),
        },
      ],
      {
        accounts: new Map([
          ['a1', 'Карта'],
          ['a2', 'Наличные'],
        ]),
        categories: new Map([
          ['c1', 'Продукты'],
          ['c2', 'Зарплата'],
        ]),
      },
      today,
    );
    expect(text).toContain(`02.11 −1${NBSP}250,50${NBSP}₽ · Продукты · Карта · Анна`);
    expect(text).toContain(`01.11 +80${NBSP}000${NBSP}₽ · Зарплата · Карта · Участник`);
    expect(text).toContain(`01.11 5${NBSP}000${NBSP}₽ · Перевод · Карта → Наличные · Борис`);
  });

  it('says so when there is nothing yet and escapes names', () => {
    expect(renderLast([], { accounts: new Map(), categories: new Map() }, today)).toContain(
      'Операций пока нет',
    );
    const text = renderLast(
      [
        {
          kind: 'TRANSACTION',
          transactionType: 'EXPENSE',
          amountMinor: '100',
          occurredOn: today,
          accountId: 'a',
          categoryId: 'c',
          createdBy: person('<Анна>'),
        },
      ],
      { accounts: new Map([['a', 'A&B']]), categories: new Map() },
      today,
    );
    expect(text).toContain('A&amp;B');
    expect(text).toContain('&lt;Анна&gt;');
  });
});

describe('renderPlans', () => {
  it('shows overdue first, then the upcoming week, with signs by kind', () => {
    const text = renderPlans(
      [
        {
          occurrenceId: 'o1',
          kind: 'OBLIGATION',
          name: 'Аренда',
          scheduledOn: '2026-10-28',
          amountMinor: '3000000',
        },
      ],
      [
        {
          occurrenceId: 'o2',
          kind: 'INCOME_PLAN',
          name: 'Зарплата',
          scheduledOn: '2026-11-05',
          amountMinor: '8000000',
        },
      ],
      today,
    );
    expect(text.indexOf('Просрочено')).toBeLessThan(text.indexOf('Ближайшие 7 дней'));
    expect(text).toContain(`• 28.10 Аренда −30${NBSP}000${NBSP}₽`);
    expect(text).toContain(`• 05.11 Зарплата +80${NBSP}000${NBSP}₽`);
  });

  it('says so when the week is empty', () => {
    expect(renderPlans([], [], today)).toContain('плановых платежей нет');
  });
});

describe('renderEvents', () => {
  it('groups by day with the weekday and shows time or "весь день"', () => {
    const text = renderEvents(
      [
        {
          occurrenceDate: '2026-11-03',
          title: 'Отпуск',
          allDay: true,
          startTime: null,
          endTime: null,
        },
        {
          occurrenceDate: '2026-11-03',
          title: 'Врач',
          allDay: false,
          startTime: '09:30',
          endTime: '10:30',
        },
        {
          occurrenceDate: '2026-11-04',
          title: 'Школа',
          allDay: false,
          startTime: '08:00',
          endTime: '09:00',
        },
      ],
      today,
    );
    expect(text).toContain('<b>03.11, вт</b>\n• весь день Отпуск\n• 09:30–10:30 Врач');
    expect(text).toContain('<b>04.11, ср</b>\n• 08:00–09:00 Школа');
  });

  it('says so when there are no events', () => {
    expect(renderEvents([], today)).toContain('событий нет');
  });
});

describe('renderBalance', () => {
  it('lists accounts, the server total and the spendable amount until the period end', () => {
    const text = renderBalance(
      [
        { name: 'Карта', currentBalanceMinor: '1230000' },
        { name: 'Наличные', currentBalanceMinor: '200000' },
      ],
      {
        cashMinor: '1430000',
        spendable: { state: 'READY', amountMinor: '540000' },
        period: { end: '2026-11-10' },
      },
      today,
    );
    expect(text).toContain(`Карта — 12${NBSP}300${NBSP}₽`);
    expect(text).toContain(`Всего на счетах: 14${NBSP}300${NBSP}₽`);
    expect(text).toContain(`Доступно до 10.11: 5${NBSP}400${NBSP}₽`);
  });

  it('asks to set up the period when the dashboard cannot tell the spendable amount', () => {
    const text = renderBalance(
      [],
      {
        cashMinor: '0',
        spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null },
        period: { end: '2026-11-10' },
      },
      today,
    );
    expect(text).toContain('Счетов пока нет');
    expect(text).toContain('настройте период в приложении');
  });
});
