import { describe, expect, it, vi } from 'vitest';

import type { TelegramCallbackButton } from '../telegram-bot.client.js';
import { decodeCallback } from './callback-data.js';
import { advanceDialog, renderDialog, startDialog } from './dialog-flow.js';
import type {
  DialogEvent,
  DialogLookups,
  DialogState,
  FlowResult,
  Screen,
} from './dialog.types.js';

const ctx = { today: '2026-11-03', budgetName: 'Семья' };

function lookups(overrides: Partial<DialogLookups> = {}): DialogLookups {
  return {
    ownAccounts: vi.fn(async () => [
      { id: 'acc-card', label: 'Карта' },
      { id: 'acc-cash', label: 'Наличные' },
    ]),
    budgetAccounts: vi.fn(async () => [
      { id: 'acc-card', label: 'Карта' },
      { id: 'acc-cash', label: 'Наличные' },
      { id: 'acc-boris', label: 'Счёт Бориса' },
    ]),
    categories: vi.fn(async (type: 'INCOME' | 'EXPENSE') =>
      type === 'EXPENSE'
        ? [
            { id: 'cat-food', label: 'Продукты' },
            { id: 'cat-cafe', label: 'Кафе' },
          ]
        : [{ id: 'cat-salary', label: 'Зарплата' }],
    ),
    envelopes: vi.fn(async () => [{ id: 'env-food', label: 'Еда' }]),
    ...overrides,
  };
}

const text = (value: string): DialogEvent => ({ type: 'text', text: value });
const press = (action: string, index: number | null = null): DialogEvent => ({
  type: 'button',
  action,
  index,
});

function continued(result: FlowResult): { state: DialogState; screen: Screen } {
  if (result.type !== 'continue') throw new Error(`expected continue, got ${result.type}`);
  return result;
}

function buttons(screen: Screen): Array<{ text: string; action: string; index: number | null }> {
  return screen.keyboard.flat().map((button) => {
    const decoded = decodeCallback((button as TelegramCallbackButton).callback_data);
    return { text: button.text, action: decoded!.action, index: decoded!.index };
  });
}

async function walk(start: FlowResult, events: DialogEvent[], source = lookups()) {
  let current = continued(start);
  for (const event of events) {
    current = continued(await advanceDialog(current.state, event, ctx, source));
  }
  return current;
}

describe('expense dialog', () => {
  it('walks amount, own account, category, envelope, date and comment to the summary', async () => {
    const source = lookups();
    const start = await startDialog('EXPENSE', ctx, source);
    const first = continued(start);
    expect(first.state).toMatchObject({ kind: 'EXPENSE', step: 'amount', version: 1 });
    expect(first.screen.text).toContain('Новый расход');
    expect(first.screen.text).toContain('Семья');

    const summary = await walk(
      start,
      [
        text('1 250,50'),
        press('pick', 0),
        press('pick', 0),
        press('pick', 0),
        press('yesterday'),
        text('магазин у дома'),
      ],
      source,
    );
    expect(summary.state.step).toBe('confirm');
    expect(summary.state.version).toBe(7);
    expect(summary.state.data).toMatchObject({
      amount: '1250.50',
      accountId: 'acc-card',
      categoryId: 'cat-food',
      envelopeId: 'env-food',
      date: '2026-11-02',
      comment: 'магазин у дома',
    });
    expect(summary.screen.text).toContain('Карта');
    expect(summary.screen.text).toContain('Продукты');
    expect(summary.screen.text).toContain('Еда');
    expect(summary.screen.text).toContain('02.11');
    expect(buttons(summary.screen).map((button) => button.action)).toEqual([
      'save',
      'edit',
      'cancel',
    ]);
    expect(source.ownAccounts).toHaveBeenCalled();
    expect(source.categories).toHaveBeenCalledWith('EXPENSE');
  });

  it('offers "Без конверта" and an empty comment', async () => {
    const summary = await walk(await startDialog('EXPENSE', ctx, lookups()), [
      text('100'),
      press('pick', 1),
      press('pick', 1),
      press('none'),
      press('today'),
      press('skip'),
    ]);
    expect(summary.state.data).toMatchObject({
      accountId: 'acc-cash',
      categoryId: 'cat-cafe',
      envelopeId: null,
      date: '2026-11-03',
      comment: null,
    });
    expect(summary.screen.text).toContain('без конверта');
  });

  it('asks again on a bad amount and keeps the step', async () => {
    const start = continued(await startDialog('EXPENSE', ctx, lookups()));
    const retry = continued(await advanceDialog(start.state, text('сто'), ctx, lookups()));
    expect(retry.state.step).toBe('amount');
    expect(retry.state.version).toBe(2);
    expect(retry.screen.text).toContain('Не понял сумму');
  });

  it('refuses a future date typed by hand and accepts a past one', async () => {
    const atDate = await walk(await startDialog('EXPENSE', ctx, lookups()), [
      text('100'),
      press('pick', 0),
      press('pick', 0),
      press('none'),
      press('other'),
    ]);
    expect(atDate.state.step).toBe('dateText');
    const future = continued(await advanceDialog(atDate.state, text('10.11'), ctx, lookups()));
    expect(future.state.step).toBe('dateText');
    expect(future.screen.text).toContain('будущем');
    const past = continued(await advanceDialog(future.state, text('01.11'), ctx, lookups()));
    expect(past.state.step).toBe('comment');
    expect(past.state.data.date).toBe('2026-11-01');
  });

  it('submits on save and returns to the summary after editing the amount', async () => {
    const summary = await walk(await startDialog('EXPENSE', ctx, lookups()), [
      text('100'),
      press('pick', 0),
      press('pick', 0),
      press('none'),
      press('today'),
      press('skip'),
    ]);
    const editing = continued(await advanceDialog(summary.state, press('edit'), ctx, lookups()));
    expect(editing.state.step).toBe('amount');
    const back = continued(await advanceDialog(editing.state, text('200'), ctx, lookups()));
    expect(back.state.step).toBe('confirm');
    expect(back.state.data).toMatchObject({ amount: '200.00', categoryId: 'cat-food' });

    const submit = await advanceDialog(back.state, press('save'), ctx, lookups());
    expect(submit).toEqual({ type: 'submit', state: back.state });
  });

  it('cancels from any step', async () => {
    const start = continued(await startDialog('EXPENSE', ctx, lookups()));
    const result = await advanceDialog(start.state, press('cancel'), ctx, lookups());
    expect(result.type).toBe('cancel');
  });

  it('treats a button that does not belong to the step as stale', async () => {
    const start = continued(await startDialog('EXPENSE', ctx, lookups()));
    expect((await advanceDialog(start.state, press('save'), ctx, lookups())).type).toBe('stale');
    const atAccount = continued(await advanceDialog(start.state, text('5'), ctx, lookups()));
    expect((await advanceDialog(atAccount.state, press('pick', 9), ctx, lookups())).type).toBe(
      'stale',
    );
  });

  it('asks to use buttons when text arrives on a choice step', async () => {
    const atAccount = await walk(await startDialog('EXPENSE', ctx, lookups()), [text('5')]);
    const again = continued(await advanceDialog(atAccount.state, text('Карта'), ctx, lookups()));
    expect(again.state.step).toBe('account');
    expect(again.screen.text).toContain('кнопкой');
  });

  it('explains an empty own-account list and offers only cancel', async () => {
    const source = lookups({ ownAccounts: vi.fn(async () => []) });
    const atAccount = await walk(await startDialog('EXPENSE', ctx, source), [text('5')], source);
    expect(atAccount.screen.text).toContain('Нет своих счетов');
    expect(buttons(atAccount.screen).map((button) => button.action)).toEqual(['cancel']);
  });

  it('pages long lists by eight and keeps absolute indexes', async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      id: `cat-${index}`,
      label: `Категория ${index}`,
    }));
    const source = lookups({ categories: vi.fn(async () => many) });
    const atCategory = await walk(
      await startDialog('EXPENSE', ctx, source),
      [text('5'), press('pick', 0)],
      source,
    );
    const firstPage = buttons(atCategory.screen);
    expect(firstPage.filter((button) => button.action === 'pick')).toHaveLength(8);
    expect(firstPage.some((button) => button.action === 'more')).toBe(true);
    const second = continued(await advanceDialog(atCategory.state, press('more'), ctx, source));
    const picks = buttons(second.screen).filter((button) => button.action === 'pick');
    expect(picks.map((button) => button.index)).toEqual([8, 9, 10]);
    const picked = continued(await advanceDialog(second.state, press('pick', 10), ctx, source));
    expect(picked.state.data.categoryId).toBe('cat-10');
  });

  it('encodes the current version into every button', async () => {
    const atAccount = await walk(await startDialog('EXPENSE', ctx, lookups()), [text('5')]);
    for (const button of atAccount.screen.keyboard.flat()) {
      const decoded = decodeCallback((button as TelegramCallbackButton).callback_data);
      expect(decoded?.version).toBe(atAccount.state.version);
    }
  });

  it('escapes names in the summary', async () => {
    const source = lookups({
      ownAccounts: vi.fn(async () => [{ id: 'acc-x', label: '<Карта & Co>' }]),
    });
    const summary = await walk(
      await startDialog('EXPENSE', ctx, source),
      [text('5'), press('pick', 0), press('pick', 0), press('none'), press('today'), press('skip')],
      source,
    );
    expect(summary.screen.text).toContain('&lt;Карта &amp; Co&gt;');
    expect(summary.screen.text).not.toContain('<Карта');
  });
});

describe('income dialog', () => {
  it('skips the envelope step and uses income categories', async () => {
    const source = lookups();
    const summary = await walk(
      await startDialog('INCOME', ctx, source),
      [text('80000'), press('pick', 0), press('pick', 0), press('today'), press('skip')],
      source,
    );
    expect(summary.state.step).toBe('confirm');
    expect(summary.state.data).toMatchObject({ categoryId: 'cat-salary', amount: '80000.00' });
    expect(summary.state.data.envelopeId).toBeUndefined();
    expect(source.categories).toHaveBeenCalledWith('INCOME');
    expect(source.envelopes).not.toHaveBeenCalled();
  });
});

describe('transfer dialog', () => {
  it('picks an own source and any other account of the budget as destination', async () => {
    const source = lookups();
    const atDestination = await walk(
      await startDialog('TRANSFER', ctx, source),
      [text('5000'), press('pick', 0)],
      source,
    );
    expect(atDestination.state.step).toBe('destination');
    expect(atDestination.state.data.choices?.map((choice) => choice.id)).toEqual([
      'acc-cash',
      'acc-boris',
    ]);
    const summary = await walk(
      { type: 'continue', state: atDestination.state, screen: atDestination.screen },
      [press('pick', 1), press('today'), press('skip')],
      source,
    );
    expect(summary.state.data).toMatchObject({
      accountId: 'acc-card',
      destinationId: 'acc-boris',
      destinationName: 'Счёт Бориса',
    });
    expect(summary.screen.text).toContain('Счёт Бориса');
  });
});

describe('event dialog', () => {
  it('walks title, date, time and reminder to the summary', async () => {
    const start = await startDialog('EVENT', ctx, lookups());
    expect(continued(start).state.step).toBe('title');
    const summary = await walk(start, [
      text('Врач'),
      press('tomorrow'),
      text('9:30'),
      press('rem', 2),
    ]);
    expect(summary.state.data).toMatchObject({
      title: 'Врач',
      date: '2026-11-04',
      allDay: false,
      startTime: '09:30',
      endTime: '10:30',
      reminderMinutes: 60,
    });
    expect(summary.screen.text).toContain('09:30–10:30');
    expect(buttons(summary.screen).map((button) => button.text)).toContain('Создать');
  });

  it('allows an all-day event in the future without a reminder', async () => {
    const summary = await walk(await startDialog('EVENT', ctx, lookups()), [
      text('Отпуск'),
      press('other'),
      text('20.12'),
      press('allday'),
      press('rem', 0),
    ]);
    expect(summary.state.data).toMatchObject({
      date: '2026-12-20',
      allDay: true,
      startTime: null,
      endTime: null,
      reminderMinutes: null,
    });
    expect(summary.screen.text).toContain('весь день');
  });

  it('rejects a title longer than 200 characters and a broken time', async () => {
    const start = continued(await startDialog('EVENT', ctx, lookups()));
    const long = continued(await advanceDialog(start.state, text('я'.repeat(201)), ctx, lookups()));
    expect(long.state.step).toBe('title');
    const atTime = await walk({ type: 'continue', state: long.state, screen: long.screen }, [
      text('Врач'),
      press('today'),
    ]);
    const broken = continued(await advanceDialog(atTime.state, text('25:00'), ctx, lookups()));
    expect(broken.state.step).toBe('time');
    expect(broken.screen.text).toContain('Не понял время');
  });
});

describe('renderDialog', () => {
  it('renders the stored step again with the same buttons', async () => {
    const atAccount = await walk(await startDialog('EXPENSE', ctx, lookups()), [text('5')]);
    expect(renderDialog(atAccount.state, ctx)).toEqual(atAccount.screen);
  });
});
