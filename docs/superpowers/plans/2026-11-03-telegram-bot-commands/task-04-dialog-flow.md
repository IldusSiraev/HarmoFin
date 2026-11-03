# Задача 4: чистые функции диалогов

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–3 закоммичены.

Вся логика шагов собрана в чистых функциях без БД и сети. Списки выбора (счета, категории, конверты) приходят через интерфейс `DialogLookups`, который в задаче 5 реализует репозиторий. Здесь его подменяют фальшивкой.

**Files:**
- Create: `apps/api/src/telegram/bot/bot-format.ts` — разбор суммы, даты и времени, форматирование рублей и дат, `escapeHtml`.
- Create: `apps/api/src/telegram/bot/bot-format.test.ts`
- Create: `apps/api/src/telegram/bot/callback-data.ts`
- Create: `apps/api/src/telegram/bot/callback-data.test.ts`
- Create: `apps/api/src/telegram/bot/dialog.types.ts`
- Create: `apps/api/src/telegram/bot/dialog-flow.ts` — шаги всех четырёх диалогов и экраны.
- Create: `apps/api/src/telegram/bot/dialog-flow.test.ts`

**Interfaces:**
- Consumes:
  - `TelegramKeyboard`, `TelegramCallbackButton` из `../telegram-bot.client.js` (задача 2);
  - `addDays(date: string, days: number): string` из `../../calendar/calendar-recurrence.js` (уже есть).
- Produces (используют задачи 5 и 6):
  - `bot-format.ts`:
    - `escapeHtml(value: string): string`;
    - `parseAmount(text: string): string | null` — `"1 250,5"` даёт `"1250.50"`;
    - `amountToMinor(amount: string): bigint`;
    - `formatRub(minor: string | bigint): string` — `"−1 250,50 ₽"`, без `,00` у целых; разделитель групп и пробел перед `₽` — NBSP ` `;
    - `formatDay(date: string, today: string): string` — `"05.11"`, а если год другой — `"05.11.2025"`;
    - `parseDay(text: string, today: string): string | null`;
    - `parseTimeRange(text: string): { startTime: string; endTime: string } | null`.
  - `callback-data.ts`:
    - `encodeCallback(version: number, action: string, index?: number): string`;
    - `decodeCallback(data: string): { version: number; action: string; index: number | null } | null`.
  - `dialog.types.ts`: `DialogKind`, `DialogStep`, `Choice`, `DialogData`, `DialogState`, `Screen`, `DialogEvent`, `DialogLookups`, `DialogContext`, `FlowResult`. Полный текст — в шаге 5.
  - `dialog-flow.ts`:
    - `DIALOG_TITLES: Record<DialogKind, string>`;
    - `startDialog(kind, ctx, lookups): Promise<FlowResult>`;
    - `advanceDialog(state, event, ctx, lookups): Promise<FlowResult>`;
    - `renderDialog(state, ctx): Screen`;
    - `REMINDERS`.

Правила машины шагов:
- Каждый вход в шаг увеличивает `version` на 1. Первый шаг нового диалога получает `version = 1`.
- Кнопки шага кодируют `version` текущего состояния.
- `FlowResult.type = 'stale'` означает, что кнопка не подходит к текущему шагу. Сервис в задаче 5 ответит «Диалог устарел».

---

- [ ] **Step 1: Тесты форматирования и разбора (падающие)**

Файл `apps/api/src/telegram/bot/bot-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  amountToMinor,
  escapeHtml,
  formatDay,
  formatRub,
  parseAmount,
  parseDay,
  parseTimeRange,
} from './bot-format.js';

const NBSP = '\u00a0';

describe('parseAmount', () => {
  it('accepts integers and up to two decimals with a comma or a dot', () => {
    expect(parseAmount('1250')).toBe('1250.00');
    expect(parseAmount('1250,5')).toBe('1250.50');
    expect(parseAmount('1250.55')).toBe('1250.55');
    expect(parseAmount('0,01')).toBe('0.01');
  });

  it('ignores spaces, no-break spaces and a trailing ruble sign', () => {
    expect(parseAmount('1 250,50')).toBe('1250.50');
    expect(parseAmount(`12${NBSP}000`)).toBe('12000.00');
    expect(parseAmount('500 ₽')).toBe('500.00');
    expect(parseAmount('500р')).toBe('500.00');
    expect(parseAmount('500 руб.')).toBe('500.00');
  });

  it('drops leading zeros so the API decimal pattern accepts the result', () => {
    expect(parseAmount('007')).toBe('7.00');
  });

  it('rejects zero, negatives, three decimals, words and too many digits', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('0,00')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1,234')).toBeNull();
    expect(parseAmount('сто')).toBeNull();
    expect(parseAmount('1e5')).toBeNull();
    expect(parseAmount('1234567890123')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('amountToMinor and formatRub', () => {
  it('converts the canonical amount to minor units without floats', () => {
    expect(amountToMinor('1250.50')).toBe(125050n);
    expect(amountToMinor('0.01')).toBe(1n);
  });

  it('formats minor units with groups, kopecks only when present and a minus sign', () => {
    expect(formatRub(125050n)).toBe(`1${NBSP}250,50${NBSP}₽`);
    expect(formatRub('100000')).toBe(`1${NBSP}000${NBSP}₽`);
    expect(formatRub('-5')).toBe(`−0,05${NBSP}₽`);
    expect(formatRub(0n)).toBe(`0${NBSP}₽`);
  });
});

describe('dates and times', () => {
  it('formats a day without the year of today', () => {
    expect(formatDay('2026-11-05', '2026-11-03')).toBe('05.11');
    expect(formatDay('2025-12-31', '2026-11-03')).toBe('31.12.2025');
  });

  it('parses DD.MM with the current year and DD.MM.YYYY', () => {
    expect(parseDay('5.11', '2026-11-03')).toBe('2026-11-05');
    expect(parseDay('05.11.2025', '2026-11-03')).toBe('2025-11-05');
    expect(parseDay(' 1.2 ', '2026-11-03')).toBe('2026-02-01');
  });

  it('rejects impossible dates and other formats', () => {
    expect(parseDay('31.02', '2026-11-03')).toBeNull();
    expect(parseDay('2026-11-05', '2026-11-03')).toBeNull();
    expect(parseDay('завтра', '2026-11-03')).toBeNull();
  });

  it('parses a start time with a one-hour default and an explicit range', () => {
    expect(parseTimeRange('9:30')).toEqual({ startTime: '09:30', endTime: '10:30' });
    expect(parseTimeRange('09.30-11:00')).toEqual({ startTime: '09:30', endTime: '11:00' });
    expect(parseTimeRange('9:30 – 11:00')).toEqual({ startTime: '09:30', endTime: '11:00' });
    expect(parseTimeRange('23:30')).toEqual({ startTime: '23:30', endTime: '23:59' });
  });

  it('rejects broken times and a range that ends before it starts', () => {
    expect(parseTimeRange('25:00')).toBeNull();
    expect(parseTimeRange('9')).toBeNull();
    expect(parseTimeRange('11:00-9:00')).toBeNull();
    expect(parseTimeRange('9:00-10:00-11:00')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapes the characters Telegram HTML cares about', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;',
    );
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/bot-format.test.ts`
Expected: FAIL: `Failed to resolve import "./bot-format.js"`.

- [ ] **Step 3: Реализация форматирования**

Файл `apps/api/src/telegram/bot/bot-format.ts`:

```ts
const NBSP = '\u00a0';
const AMOUNT = /^(\d{1,12})(?:[.,](\d{1,2}))?$/;
const CURRENCY_SUFFIX = /(?:₽|руб\.?|р\.?)$/i;
const DAY = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/;
const CLOCK = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
const LAST_MINUTE = 23 * 60 + 59;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * "1 250,5" -> "1250.50": the canonical decimal string the API schemas accept. Only digits are
 * read as text; no float ever holds the amount. Null for zero, signs, words or more than two
 * decimals.
 */
export function parseAmount(text: string): string | null {
  const compact = text.replace(/\s/g, '').replace(CURRENCY_SUFFIX, '');
  const match = AMOUNT.exec(compact);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (whole === 0n && fraction === '00') return null;
  return `${whole.toString()}.${fraction}`;
}

/** Canonical "1250.50" to minor units. */
export function amountToMinor(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

/** Minor units to "1 250,50 ₽" (display text only; kopecks hidden when zero). */
export function formatRub(minor: string | bigint): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const kopecks = absolute % 100n;
  const tail = kopecks === 0n ? '' : `,${kopecks.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}${whole}${tail}${NBSP}₽`;
}

/** "2026-11-05" -> "05.11"; the year is shown only when it differs from today's. */
export function formatDay(date: string, today: string): string {
  const [year, month, day] = date.split('-');
  return year === today.slice(0, 4) ? `${day}.${month}` : `${day}.${month}.${year}`;
}

/** "5.11" (year of today) or "05.11.2026" -> "2026-11-05"; null for an impossible date. */
export function parseDay(text: string, today: string): string | null {
  const match = DAY.exec(text.trim());
  if (!match) return null;
  const year = match[3] ?? today.slice(0, 4);
  const iso = `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseClock(text: string): string | null {
  const match = CLOCK.exec(text.trim());
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

function clockOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "9:30" -> 09:30–10:30 (never past 23:59); "9:30-11:00" -> as written. */
export function parseTimeRange(text: string): { startTime: string; endTime: string } | null {
  const parts = text.replace(/[–—]/g, '-').split('-');
  if (parts.length > 2) return null;
  const startTime = parseClock(parts[0]!);
  if (!startTime) return null;
  if (parts.length === 2) {
    const endTime = parseClock(parts[1]!);
    if (!endTime || endTime < startTime) return null;
    return { startTime, endTime };
  }
  const [hours, minutes] = startTime.split(':').map(Number) as [number, number];
  return { startTime, endTime: clockOf(Math.min(hours * 60 + minutes + 60, LAST_MINUTE)) };
}
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/bot-format.test.ts`
Expected: PASS.

- [ ] **Step 4: `callback_data` (тест и реализация)**

Файл `apps/api/src/telegram/bot/callback-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { decodeCallback, encodeCallback } from './callback-data.js';

describe('callback data', () => {
  it('encodes version, action and an optional index', () => {
    expect(encodeCallback(3, 'pick', 12)).toBe('3:pick:12');
    expect(encodeCallback(41, 'save')).toBe('41:save');
  });

  it('decodes what it encodes', () => {
    expect(decodeCallback('3:pick:12')).toEqual({ version: 3, action: 'pick', index: 12 });
    expect(decodeCallback('41:save')).toEqual({ version: 41, action: 'save', index: null });
  });

  it('rejects anything else, including ids and oversized values', () => {
    expect(decodeCallback('')).toBeNull();
    expect(decodeCallback('save')).toBeNull();
    expect(decodeCallback('3:pick:0190f7a2-aaaa')).toBeNull();
    expect(decodeCallback('3:Pick')).toBeNull();
    expect(decodeCallback('1234567:save')).toBeNull();
    expect(decodeCallback('3:pick:1000')).toBeNull();
  });

  it('never produces more than 64 bytes', () => {
    expect(Buffer.byteLength(encodeCallback(999_999, 'abcdefghijkl', 999))).toBeLessThanOrEqual(
      64,
    );
  });

  it('refuses to encode values the decoder would reject', () => {
    expect(() => encodeCallback(0, 'save')).toThrow();
    expect(() => encodeCallback(1, 'Save')).toThrow();
    expect(() => encodeCallback(1, 'pick', 1000)).toThrow();
  });
});
```

Файл `apps/api/src/telegram/bot/callback-data.ts`:

```ts
/**
 * Inline-button payload "<version>:<action>[:<index>]" (Telegram allows 64 bytes). It never holds
 * ids: the index points into the choice list stored in the dialog state of that version.
 */
export type CallbackAction = { version: number; action: string; index: number | null };

const PATTERN = /^([1-9]\d{0,5}):([a-z]{1,12})(?::(\d{1,3}))?$/;

export function encodeCallback(version: number, action: string, index?: number): string {
  const data = index === undefined ? `${version}:${action}` : `${version}:${action}:${index}`;
  if (!PATTERN.test(data)) throw new Error('Invalid callback data');
  return data;
}

export function decodeCallback(data: string): CallbackAction | null {
  const match = PATTERN.exec(data);
  if (!match) return null;
  return {
    version: Number(match[1]),
    action: match[2]!,
    index: match[3] === undefined ? null : Number(match[3]),
  };
}
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/callback-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Типы диалога**

Файл `apps/api/src/telegram/bot/dialog.types.ts`:

```ts
import type { TelegramKeyboard } from '../telegram-bot.client.js';

export type DialogKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'EVENT';

export type DialogStep =
  | 'amount'
  | 'account'
  | 'destination'
  | 'category'
  | 'envelope'
  | 'date'
  | 'dateText'
  | 'comment'
  | 'title'
  | 'time'
  | 'reminder'
  | 'confirm';

/** One button of a choice list: the id never leaves the server, the button carries an index. */
export type Choice = { id: string; label: string };

/** Collected answers plus the choice list of the current step. Stored as JSON. */
export type DialogData = {
  amount?: string;
  accountId?: string;
  accountName?: string;
  destinationId?: string;
  destinationName?: string;
  categoryId?: string;
  categoryName?: string;
  envelopeId?: string | null;
  envelopeName?: string | null;
  date?: string;
  comment?: string | null;
  title?: string;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reminderMinutes?: number | null;
  choices?: Choice[];
  page?: number;
  /** Set by "Изменить" on the summary: after the edited answer the dialog returns to the summary. */
  editing?: boolean;
  /** Short message shown above the prompt (bad input or a refused save). */
  error?: string | null;
};

export type DialogState = {
  kind: DialogKind;
  step: DialogStep;
  version: number;
  data: DialogData;
};

export type Screen = { text: string; keyboard: TelegramKeyboard };

export type DialogEvent =
  | { type: 'text'; text: string }
  | { type: 'button'; action: string; index: number | null };

/** Lists the user may pick from; every list is already filtered by budget and ownership. */
export interface DialogLookups {
  ownAccounts(): Promise<Choice[]>;
  budgetAccounts(): Promise<Choice[]>;
  categories(type: 'INCOME' | 'EXPENSE'): Promise<Choice[]>;
  envelopes(): Promise<Choice[]>;
}

export type DialogContext = { today: string; budgetName: string };

export type FlowResult =
  | { type: 'continue'; state: DialogState; screen: Screen }
  | { type: 'submit'; state: DialogState }
  | { type: 'cancel'; screen: Screen }
  | { type: 'stale' };
```

- [ ] **Step 6: Тесты машины шагов (падающие)**

Файл `apps/api/src/telegram/bot/dialog-flow.test.ts`:

```ts
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
    const atTime = await walk(
      { type: 'continue', state: long.state, screen: long.screen },
      [text('Врач'), press('today')],
    );
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
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/dialog-flow.test.ts`
Expected: FAIL: `Failed to resolve import "./dialog-flow.js"`.

- [ ] **Step 7: Машина шагов**

Файл `apps/api/src/telegram/bot/dialog-flow.ts`:

```ts
import { addDays } from '../../calendar/calendar-recurrence.js';
import type { TelegramCallbackButton, TelegramKeyboard } from '../telegram-bot.client.js';
import {
  amountToMinor,
  escapeHtml,
  formatDay,
  formatRub,
  parseAmount,
  parseDay,
  parseTimeRange,
} from './bot-format.js';
import { encodeCallback } from './callback-data.js';
import type {
  Choice,
  DialogContext,
  DialogData,
  DialogEvent,
  DialogKind,
  DialogLookups,
  DialogState,
  DialogStep,
  FlowResult,
  Screen,
} from './dialog.types.js';

const PAGE_SIZE = 8;
const LABEL_MAX = 32;
const COMMENT_MAX = 500;
const TITLE_MAX = 200;

export const DIALOG_TITLES: Record<DialogKind, string> = {
  EXPENSE: 'Новый расход',
  INCOME: 'Новый доход',
  TRANSFER: 'Новый перевод',
  EVENT: 'Новое событие',
};

export const REMINDERS: ReadonlyArray<{ minutes: number | null; label: string }> = [
  { minutes: null, label: 'Нет' },
  { minutes: 15, label: 'За 15 мин' },
  { minutes: 60, label: 'За 1 час' },
  { minutes: 1440, label: 'За день' },
];

const ORDER: Record<DialogKind, DialogStep[]> = {
  EXPENSE: ['amount', 'account', 'category', 'envelope', 'date', 'comment', 'confirm'],
  INCOME: ['amount', 'account', 'category', 'date', 'comment', 'confirm'],
  TRANSFER: ['amount', 'account', 'destination', 'date', 'comment', 'confirm'],
  EVENT: ['title', 'date', 'time', 'reminder', 'confirm'],
};

const LIST_STEPS: ReadonlySet<DialogStep> = new Set([
  'account',
  'destination',
  'category',
  'envelope',
]);

const ERRORS = {
  amount: 'Не понял сумму. Пример: 1250 или 1250,50.',
  date: 'Не понял дату. Пример: 05.11 или 05.11.2026.',
  future: 'Дата не может быть в будущем.',
  time: 'Не понял время. Пример: 9:30 или 9:30-11:00.',
  comment: `Комментарий — не длиннее ${COMMENT_MAX} символов.`,
  title: `Название — от 1 до ${TITLE_MAX} символов.`,
  buttons: 'Выберите вариант кнопкой.',
  confirm: 'Нажмите кнопку под сводкой.',
} as const;

function nextStep(kind: DialogKind, step: DialogStep): DialogStep {
  const order = ORDER[kind];
  const from = step === 'dateText' ? 'date' : step;
  return order[order.indexOf(from) + 1] ?? 'confirm';
}

async function loadChoices(
  kind: DialogKind,
  step: DialogStep,
  data: DialogData,
  lookups: DialogLookups,
): Promise<Choice[]> {
  switch (step) {
    case 'account':
      return lookups.ownAccounts();
    case 'destination':
      return (await lookups.budgetAccounts()).filter((choice) => choice.id !== data.accountId);
    case 'category':
      return lookups.categories(kind === 'INCOME' ? 'INCOME' : 'EXPENSE');
    case 'envelope':
      return lookups.envelopes();
    default:
      return [];
  }
}

async function enter(
  state: DialogState,
  step: DialogStep,
  data: DialogData,
  ctx: DialogContext,
  lookups: DialogLookups,
  error: string | null = null,
): Promise<FlowResult> {
  const nextData: DialogData = { ...data, error, page: 0 };
  if (LIST_STEPS.has(step)) {
    nextData.choices = await loadChoices(state.kind, step, data, lookups);
  } else {
    delete nextData.choices;
  }
  const next: DialogState = { kind: state.kind, step, version: state.version + 1, data: nextData };
  return { type: 'continue', state: next, screen: renderDialog(next, ctx) };
}

/** The first step of a new dialog; its version is 1. */
export function startDialog(
  kind: DialogKind,
  ctx: DialogContext,
  lookups: DialogLookups,
): Promise<FlowResult> {
  const first = ORDER[kind][0]!;
  return enter({ kind, step: first, version: 0, data: {} }, first, {}, ctx, lookups);
}

/** Applies one answer (typed text or a pressed button) to the current step. */
export async function advanceDialog(
  state: DialogState,
  event: DialogEvent,
  ctx: DialogContext,
  lookups: DialogLookups,
): Promise<FlowResult> {
  if (event.type === 'button' && event.action === 'cancel') {
    return {
      type: 'cancel',
      screen: { text: `<b>${DIALOG_TITLES[state.kind]}</b>\nВвод отменён.`, keyboard: [] },
    };
  }
  const data = state.data;
  const stay = (error: string) => enter(state, state.step, data, ctx, lookups, error);
  const forward = (answer: DialogData) => {
    const merged: DialogData = { ...data, ...answer };
    if (data.editing) {
      merged.editing = false;
      return enter(state, 'confirm', merged, ctx, lookups);
    }
    return enter(state, nextStep(state.kind, state.step), merged, ctx, lookups);
  };
  const stale: FlowResult = { type: 'stale' };

  switch (state.step) {
    case 'amount': {
      if (event.type !== 'text') return stale;
      const amount = parseAmount(event.text);
      return amount ? forward({ amount }) : stay(ERRORS.amount);
    }
    case 'title': {
      if (event.type !== 'text') return stale;
      const title = event.text.trim();
      return title.length > 0 && title.length <= TITLE_MAX ? forward({ title }) : stay(ERRORS.title);
    }
    case 'account':
    case 'destination':
    case 'category':
    case 'envelope': {
      if (event.type === 'text') return stay(ERRORS.buttons);
      const choices = data.choices ?? [];
      if (event.action === 'more') {
        const pages = Math.max(Math.ceil(choices.length / PAGE_SIZE), 1);
        const next: DialogState = {
          ...state,
          version: state.version + 1,
          data: { ...data, page: ((data.page ?? 0) + 1) % pages, error: null },
        };
        return { type: 'continue', state: next, screen: renderDialog(next, ctx) };
      }
      if (state.step === 'envelope' && event.action === 'none') {
        return forward({ envelopeId: null, envelopeName: null });
      }
      if (event.action !== 'pick' || event.index === null) return stale;
      const choice = choices[event.index];
      if (!choice) return stale;
      if (state.step === 'account') return forward({ accountId: choice.id, accountName: choice.label });
      if (state.step === 'destination') {
        return forward({ destinationId: choice.id, destinationName: choice.label });
      }
      if (state.step === 'category') {
        return forward({ categoryId: choice.id, categoryName: choice.label });
      }
      return forward({ envelopeId: choice.id, envelopeName: choice.label });
    }
    case 'date':
    case 'dateText': {
      if (event.type === 'text') {
        const date = parseDay(event.text, ctx.today);
        if (!date) return stay(ERRORS.date);
        if (state.kind !== 'EVENT' && date > ctx.today) return stay(ERRORS.future);
        return forward({ date });
      }
      if (state.step === 'dateText') return stale;
      if (event.action === 'today') return forward({ date: ctx.today });
      if (event.action === 'yesterday' && state.kind !== 'EVENT') {
        return forward({ date: addDays(ctx.today, -1) });
      }
      if (event.action === 'tomorrow' && state.kind === 'EVENT') {
        return forward({ date: addDays(ctx.today, 1) });
      }
      if (event.action === 'other') return enter(state, 'dateText', data, ctx, lookups);
      return stale;
    }
    case 'comment': {
      if (event.type === 'text') {
        return event.text.length <= COMMENT_MAX
          ? forward({ comment: event.text })
          : stay(ERRORS.comment);
      }
      return event.action === 'skip' ? forward({ comment: null }) : stale;
    }
    case 'time': {
      if (event.type === 'text') {
        const range = parseTimeRange(event.text);
        return range ? forward({ allDay: false, ...range }) : stay(ERRORS.time);
      }
      return event.action === 'allday'
        ? forward({ allDay: true, startTime: null, endTime: null })
        : stale;
    }
    case 'reminder': {
      if (event.type === 'text') return stay(ERRORS.buttons);
      const reminder = event.action === 'rem' && event.index !== null ? REMINDERS[event.index] : null;
      return reminder ? forward({ reminderMinutes: reminder.minutes }) : stale;
    }
    case 'confirm': {
      if (event.type === 'text') return stay(ERRORS.confirm);
      if (event.action === 'save') return { type: 'submit', state };
      if (event.action === 'edit') {
        const step: DialogStep = state.kind === 'EVENT' ? 'title' : 'amount';
        return enter(state, step, { ...data, editing: true }, ctx, lookups);
      }
      return stale;
    }
  }
}

function label(value: string): string {
  return value.length > LABEL_MAX ? `${value.slice(0, LABEL_MAX - 1)}…` : value;
}

function button(
  text: string,
  version: number,
  action: string,
  index?: number,
): TelegramCallbackButton {
  return { text, callback_data: encodeCallback(version, action, index) };
}

function listKeyboard(state: DialogState, head: TelegramKeyboard): TelegramKeyboard {
  const choices = state.data.choices ?? [];
  const page = state.data.page ?? 0;
  const start = page * PAGE_SIZE;
  const rows: TelegramKeyboard = [...head];
  const slice = choices.slice(start, start + PAGE_SIZE);
  for (let offset = 0; offset < slice.length; offset += 2) {
    rows.push(
      slice
        .slice(offset, offset + 2)
        .map((choice, inRow) =>
          button(label(choice.label), state.version, 'pick', start + offset + inRow),
        ),
    );
  }
  if (choices.length > PAGE_SIZE) rows.push([button('Ещё ›', state.version, 'more')]);
  rows.push([button('Отмена', state.version, 'cancel')]);
  return rows;
}

function reminderLabel(minutes: number | null | undefined): string {
  return REMINDERS.find((reminder) => reminder.minutes === (minutes ?? null))?.label ?? 'Нет';
}

function summaryLines(state: DialogState, ctx: DialogContext): string[] {
  const data = state.data;
  const day = data.date ? formatDay(data.date, ctx.today) : '—';
  if (state.kind === 'EVENT') {
    return [
      `Название: ${escapeHtml(data.title ?? '')}`,
      `Дата: ${day}`,
      `Время: ${data.allDay ? 'весь день' : `${data.startTime}–${data.endTime}`}`,
      `Напоминание: ${reminderLabel(data.reminderMinutes)}`,
    ];
  }
  const lines = [`Сумма: ${formatRub(amountToMinor(data.amount ?? '0'))}`];
  if (state.kind === 'TRANSFER') {
    lines.push(
      `Откуда: ${escapeHtml(data.accountName ?? '')}`,
      `Куда: ${escapeHtml(data.destinationName ?? '')}`,
    );
  } else {
    lines.push(
      `Счёт: ${escapeHtml(data.accountName ?? '')}`,
      `Категория: ${escapeHtml(data.categoryName ?? '')}`,
    );
    if (state.kind === 'EXPENSE') {
      lines.push(`Конверт: ${data.envelopeName ? escapeHtml(data.envelopeName) : 'без конверта'}`);
    }
  }
  lines.push(`Дата: ${day}`, `Комментарий: ${data.comment ? escapeHtml(data.comment) : '—'}`);
  return lines;
}

/** Text and keyboard of the current step; the same state always renders the same screen. */
export function renderDialog(state: DialogState, ctx: DialogContext): Screen {
  const v = state.version;
  const head = [`<b>${DIALOG_TITLES[state.kind]}</b> · ${escapeHtml(ctx.budgetName)}`];
  if (state.data.error) head.push(`<i>${escapeHtml(state.data.error)}</i>`);
  const cancel = [button('Отмена', v, 'cancel')];
  const screen = (prompt: string, keyboard: TelegramKeyboard): Screen => ({
    text: [...head, prompt].join('\n'),
    keyboard,
  });
  const list = (prompt: string, empty: string, extra: TelegramKeyboard = []): Screen =>
    (state.data.choices ?? []).length === 0 && extra.length === 0
      ? screen(empty, [cancel])
      : screen(prompt, listKeyboard(state, extra));

  switch (state.step) {
    case 'amount':
      return screen('Введите сумму, например 1250 или 1250,50.', [cancel]);
    case 'account':
      return list(
        state.kind === 'TRANSFER' ? 'Откуда перевести?' : 'Выберите счёт.',
        'Нет своих счетов: добавьте счёт в приложении.',
      );
    case 'destination':
      return list('Куда перевести?', 'Нет другого счёта для перевода.');
    case 'category':
      return list('Выберите категорию.', 'Нет подходящих категорий: добавьте их в приложении.');
    case 'envelope':
      return list('Из какого конверта?', '', [[button('Без конверта', v, 'none')]]);
    case 'date':
      return state.kind === 'EVENT'
        ? screen('Когда? Можно написать дату: ДД.ММ.', [
            [button('Сегодня', v, 'today'), button('Завтра', v, 'tomorrow')],
            [button('Другая дата', v, 'other')],
            cancel,
          ])
        : screen('Дата операции? Можно написать: ДД.ММ.', [
            [button('Сегодня', v, 'today'), button('Вчера', v, 'yesterday')],
            [button('Другая дата', v, 'other')],
            cancel,
          ]);
    case 'dateText':
      return screen('Введите дату: ДД.ММ или ДД.ММ.ГГГГ.', [cancel]);
    case 'comment':
      return screen('Комментарий? Напишите текст или нажмите «Пропустить».', [
        [button('Пропустить', v, 'skip')],
        cancel,
      ]);
    case 'title':
      return screen('Как назвать событие?', [cancel]);
    case 'time':
      return screen('Время: напишите 9:30 или 9:30-11:00 либо нажмите «Весь день».', [
        [button('Весь день', v, 'allday')],
        cancel,
      ]);
    case 'reminder':
      return screen('Напомнить?', [
        [button(REMINDERS[0]!.label, v, 'rem', 0), button(REMINDERS[1]!.label, v, 'rem', 1)],
        [button(REMINDERS[2]!.label, v, 'rem', 2), button(REMINDERS[3]!.label, v, 'rem', 3)],
        cancel,
      ]);
    case 'confirm':
      return screen(summaryLines(state, ctx).join('\n'), [
        [
          button(state.kind === 'EVENT' ? 'Создать' : 'Провести', v, 'save'),
          button(state.kind === 'EVENT' ? 'Изменить название' : 'Изменить сумму', v, 'edit'),
        ],
        cancel,
      ]);
  }
}
```

Пояснения для исполнителя:
- `enter` всегда сбрасывает `page` и перезагружает список, поэтому повторный вход в шаг показывает актуальные счета.
- Текст на шаге даты принимается сразу, без кнопки «Другая дата».
- Шаги `title` и `amount` после «Изменить» возвращают к сводке.

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot`
Expected: PASS: bot-format, callback-data, dialog-flow.

- [ ] **Step 8: Проверки**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors. Если `lint` ругается на `switch` без `default` в `advanceDialog` или `renderDialog`, добавить в конец `switch` строку `default: return stale;` (в `renderDialog` — `default: return screen('', [cancel]);`). Это допустимое отступление: TypeScript и так проверяет полноту.

Run: `pnpm exec prettier --check apps/api/src/telegram/bot`
Expected: PASS. Если упало — `--write`.

- [ ] **Step 9: Review по чек-листу**

Выполнить `git add apps/api/src/telegram/bot`, затем просмотреть `git diff --staged`.

- **financial:**
  - сумма разбирается только как текст и в API уходит каноническая строка;
  - нет `Number()` и `parseFloat` для денег;
  - ноль и отрицательные суммы не проходят;
  - будущая дата у операции не проходит;
  - конверт у дохода не собирается.
- **QA:**
  - покрыты все четыре диалога, ошибки ввода, «Изменить», «Отмена», листание, устаревшие кнопки, пустые списки;
  - в `callback_data` нет id;
  - HTML экранируется.
- **final:**
  - нет БД, сети и Nest;
  - `renderDialog(state)` детерминирован;
  - лишних файлов нет.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): шаги диалогов бота и разбор ввода"
```

Добавить строку в «Ход выполнения».
