# Задача 6: команды просмотра

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–5 закоммичены.

Команды `/last`, `/plans`, `/events` и `/balance` читают данные через существующие сервисы, с теми же правами, что у веба. Бот ничего не считает. «Всего на счетах» и «Доступно» берутся из сводки дашборда (`cashMinor`, `spendable`), а сам бот только форматирует строки.

**Files:**
- Create: `apps/api/src/telegram/bot/bot-views.ts` — чистые функции текста.
- Create: `apps/api/src/telegram/bot/bot-views.test.ts`
- Create: `apps/api/src/telegram/bot/telegram-bot-views.ts` — загрузка данных и экраны.
- Modify: `apps/api/src/telegram/bot/telegram-bot.repository.ts` — `accountNames`, `categoryNames`.
- Modify: `apps/api/src/telegram/bot/telegram-command.service.ts` — параметр `views` и маршрут команд просмотра.
- Modify: `apps/api/src/telegram/telegram.module.ts` — создание `TelegramBotViews`.
- Create: `apps/api/test/telegram-bot-views.integration.test.ts`

**Interfaces:**
- Consumes:
  - задача 4: `escapeHtml`, `formatRub`, `formatDay`; задача 2: `webButton`, `TelegramButton`, `TelegramKeyboard`;
  - задача 5: `BotContext`, `TelegramBotRepository`, `TelegramCommandService`, `Screen`;
  - существующие сервисы:
    - `JournalApplicationService.list(userId, budgetId, { limit, status })` — возвращает `{ items: JournalItem[] }`;
    - `PlansCalendarApplicationService.calendar(userId, budgetId, { month })` — возвращает `{ items, overdue }`, где у элемента есть `occurrenceId`, `kind`, `name`, `scheduledOn`, `status`, `unpaidMinor`, `overdue`;
    - `CalendarApplicationService.feed(userId, budgetId, { from, to, includePlans: false })`;
    - `AccountApplicationService.list(userId, budgetId, 'active')` — возвращает `AccountView[]` с полями `name` и `currentBalanceMinor`;
    - `DashboardV2ApplicationService.summary(userId, budgetId)` — возвращает `cashMinor`, `spendable: { state, amountMinor }`, `period: { end }`;
  - вспомогательные функции:
    - `monthsOf({ from, to })` из `../../calendar/calendar-feed.js`;
    - `addDays` и `isoWeekday` из `../../calendar/calendar-recurrence.js`.
- Produces:
  - `BotViewRenderer { render(command: string, ctx: BotContext): Promise<Screen | null> }` — `null`, если это не команда просмотра;
  - конструктор `TelegramCommandService(repository, bot, writers, webBaseUrl, views?, limiter?, now?)`.

---

- [ ] **Step 1: Тесты текста (падающие)**

Файл `apps/api/src/telegram/bot/bot-views.test.ts`:

```ts
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
          unpaidMinor: '3000000',
        },
      ],
      [
        {
          occurrenceId: 'o2',
          kind: 'INCOME_PLAN',
          name: 'Зарплата',
          scheduledOn: '2026-11-05',
          unpaidMinor: '8000000',
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
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/bot-views.test.ts`
Expected: FAIL: `Failed to resolve import "./bot-views.js"`.

- [ ] **Step 2: Текст команд просмотра**

Файл `apps/api/src/telegram/bot/bot-views.ts`:

```ts
import { isoWeekday } from '../../calendar/calendar-recurrence.js';
import { escapeHtml, formatDay, formatRub } from './bot-format.js';

const MAX_LINES = 15;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;

type Author = { displayName: string | null };

/** Only the journal fields the bot shows (JournalItem from the journal service fits). */
export type LastItem =
  | {
      kind: 'TRANSACTION';
      transactionType: 'INCOME' | 'EXPENSE';
      amountMinor: string;
      occurredOn: string;
      accountId: string;
      categoryId: string;
      createdBy: Author;
    }
  | {
      kind: 'TRANSFER';
      amountMinor: string;
      occurredOn: string;
      sourceAccountId: string;
      destinationAccountId: string;
      createdBy: Author;
    };

export type PlanLine = {
  occurrenceId: string;
  kind: 'OBLIGATION' | 'INCOME_PLAN';
  name: string;
  scheduledOn: string;
  unpaidMinor: string;
};

export type EventLine = {
  occurrenceDate: string;
  title: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type BalanceAccount = { name: string; currentBalanceMinor: string };

export type BalanceSummary = {
  cashMinor: string;
  spendable: { state: 'READY' | 'NEEDS_PERIOD_SETUP'; amountMinor: string | null };
  period: { end: string };
};

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  return [...lines.slice(0, MAX_LINES), `… и ещё ${lines.length - MAX_LINES}`];
}

export function renderLast(
  items: LastItem[],
  names: { accounts: Map<string, string>; categories: Map<string, string> },
  today: string,
): string {
  const title = '<b>Последние операции</b>';
  if (items.length === 0) return `${title}\nОпераций пока нет.`;
  const account = (id: string) => escapeHtml(names.accounts.get(id) ?? 'счёт');
  const lines = items.map((item) => {
    const day = formatDay(item.occurredOn, today);
    const author = escapeHtml(item.createdBy.displayName ?? 'Участник');
    if (item.kind === 'TRANSFER') {
      return `${day} ${formatRub(item.amountMinor)} · Перевод · ${account(item.sourceAccountId)} → ${account(item.destinationAccountId)} · ${author}`;
    }
    const sign = item.transactionType === 'EXPENSE' ? '−' : '+';
    const category = escapeHtml(names.categories.get(item.categoryId) ?? 'без категории');
    return `${day} ${sign}${formatRub(item.amountMinor)} · ${category} · ${account(item.accountId)} · ${author}`;
  });
  return [title, ...lines].join('\n');
}

export function renderPlans(overdue: PlanLine[], upcoming: PlanLine[], today: string): string {
  const title = '<b>Плановые платежи</b>';
  if (overdue.length === 0 && upcoming.length === 0) {
    return `${title}\nНа 7 дней плановых платежей нет.`;
  }
  const line = (plan: PlanLine) =>
    `• ${formatDay(plan.scheduledOn, today)} ${escapeHtml(plan.name)} ${
      plan.kind === 'OBLIGATION' ? '−' : '+'
    }${formatRub(plan.unpaidMinor)}`;
  const parts = [title];
  if (overdue.length > 0) parts.push('', '<b>Просрочено</b>', ...capped(overdue.map(line)));
  if (upcoming.length > 0) {
    parts.push('', '<b>Ближайшие 7 дней</b>', ...capped(upcoming.map(line)));
  }
  return parts.join('\n');
}

export function renderEvents(items: EventLine[], today: string): string {
  const title = '<b>События на 7 дней</b>';
  if (items.length === 0) return `${title}\nЗа 7 дней событий нет.`;
  const parts = [title];
  let day: string | null = null;
  for (const item of items.slice(0, MAX_LINES * 2)) {
    if (item.occurrenceDate !== day) {
      day = item.occurrenceDate;
      parts.push(
        '',
        `<b>${formatDay(day, today)}, ${WEEKDAYS[isoWeekday(day) - 1]}</b>`,
      );
    }
    const time = item.allDay ? 'весь день' : `${item.startTime}–${item.endTime}`;
    parts.push(`• ${time} ${escapeHtml(item.title)}`);
  }
  return parts.join('\n');
}

export function renderBalance(
  accounts: BalanceAccount[],
  summary: BalanceSummary,
  today: string,
): string {
  const parts = ['<b>Остатки на счетах</b>'];
  if (accounts.length === 0) parts.push('Счетов пока нет.');
  parts.push(
    ...capped(
      accounts.map((account) => `${escapeHtml(account.name)} — ${formatRub(account.currentBalanceMinor)}`),
    ),
  );
  parts.push('', `Всего на счетах: ${formatRub(summary.cashMinor)}`);
  parts.push(
    summary.spendable.state === 'READY' && summary.spendable.amountMinor !== null
      ? `Доступно до ${formatDay(summary.period.end, today)}: ${formatRub(summary.spendable.amountMinor)}`
      : 'Доступно: настройте период в приложении.',
  );
  return parts.join('\n');
}
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/bot/bot-views.test.ts`
Expected: PASS. Ожидаемая строка в тесте `renderEvents` записана с `\n` между строками: между заголовком дня и событиями пустой строки нет, она стоит только перед заголовком.

- [ ] **Step 3: Имена для `/last`**

В `apps/api/src/telegram/bot/telegram-bot.repository.ts` в конец класса (перед последней `}`) добавить:

```ts

  /** Names of every account of the budget, archived included: the journal shows old rows too. */
  async accountNames(budgetId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.account.findMany({
      where: { budgetId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async categoryNames(budgetId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.category.findMany({
      where: { budgetId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
```

- [ ] **Step 4: Загрузка данных и экраны**

Файл `apps/api/src/telegram/bot/telegram-bot-views.ts`:

```ts
import type { AccountApplicationService } from '../../accounts/account.application.service.js';
import type { CalendarApplicationService } from '../../calendar/calendar.application.service.js';
import { monthsOf } from '../../calendar/calendar-feed.js';
import { addDays } from '../../calendar/calendar-recurrence.js';
import type { PlansCalendarApplicationService } from '../../plans-calendar/plans-calendar.application.service.js';
import type { DashboardV2ApplicationService } from '../../v2-dashboard/dashboard-v2.application.service.js';
import type { JournalApplicationService } from '../../v2-journal/journal.application.service.js';
import { webButton, type TelegramButton, type TelegramKeyboard } from '../telegram-bot.client.js';
import { renderBalance, renderEvents, renderLast, renderPlans, type PlanLine } from './bot-views.js';
import type { Screen } from './dialog.types.js';
import type { BotContext } from './telegram-command.service.js';
import type { TelegramBotRepository } from './telegram-bot.repository.js';

const WEEK_DAYS = 7;
const LAST_LIMIT = 10;
const OPEN_STATUSES = new Set(['PENDING', 'DUE']);

export interface BotViewRenderer {
  /** Null when the command is not a read-only one. */
  render(command: string, ctx: BotContext): Promise<Screen | null>;
}

/** Read services with the same access checks as the web; the bot only formats their answers. */
export type BotReaders = {
  journal: Pick<JournalApplicationService, 'list'>;
  plans: Pick<PlansCalendarApplicationService, 'calendar'>;
  calendar: Pick<CalendarApplicationService, 'feed'>;
  accounts: Pick<AccountApplicationService, 'list'>;
  dashboard: Pick<DashboardV2ApplicationService, 'summary'>;
};

const rows = (buttons: TelegramButton[]): TelegramKeyboard => buttons.map((button) => [button]);

export class TelegramBotViews implements BotViewRenderer {
  constructor(
    private readonly readers: BotReaders,
    private readonly names: Pick<TelegramBotRepository, 'accountNames' | 'categoryNames'>,
    private readonly webBaseUrl: string,
  ) {}

  async render(command: string, ctx: BotContext): Promise<Screen | null> {
    switch (command) {
      case 'last':
        return this.last(ctx);
      case 'plans':
        return this.plans(ctx);
      case 'events':
        return this.events(ctx);
      case 'balance':
        return this.balance(ctx);
      default:
        return null;
    }
  }

  private async last(ctx: BotContext): Promise<Screen> {
    const page = await this.readers.journal.list(ctx.userId, ctx.budgetId, {
      limit: LAST_LIMIT,
      status: 'CONFIRMED',
    });
    const [accounts, categories] = await Promise.all([
      this.names.accountNames(ctx.budgetId),
      this.names.categoryNames(ctx.budgetId),
    ]);
    return {
      text: renderLast(page.items, { accounts, categories }, ctx.today),
      keyboard: rows(webButton(this.webBaseUrl, 'Журнал', '/app/operations')),
    };
  }

  private async plans(ctx: BotContext): Promise<Screen> {
    const to = addDays(ctx.today, WEEK_DAYS - 1);
    const views = [];
    for (const month of monthsOf({ from: ctx.today, to })) {
      views.push(await this.readers.plans.calendar(ctx.userId, ctx.budgetId, { month }));
    }
    const line = (item: {
      occurrenceId: string;
      kind: 'OBLIGATION' | 'INCOME_PLAN';
      name: string;
      scheduledOn: string;
      unpaidMinor: string;
    }): PlanLine => ({
      occurrenceId: item.occurrenceId,
      kind: item.kind,
      name: item.name,
      scheduledOn: item.scheduledOn,
      unpaidMinor: item.unpaidMinor,
    });
    const overdue = (views[0]?.overdue ?? []).map(line);
    const seen = new Set(overdue.map((item) => item.occurrenceId));
    const upcoming: PlanLine[] = [];
    for (const item of views.flatMap((view) => view.items)) {
      if (item.overdue || !OPEN_STATUSES.has(item.status)) continue;
      if (item.scheduledOn < ctx.today || item.scheduledOn > to) continue;
      if (seen.has(item.occurrenceId)) continue;
      seen.add(item.occurrenceId);
      upcoming.push(line(item));
    }
    upcoming.sort((left, right) => left.scheduledOn.localeCompare(right.scheduledOn));
    return {
      text: renderPlans(overdue, upcoming, ctx.today),
      keyboard: rows(webButton(this.webBaseUrl, 'Планы', '/app/plans')),
    };
  }

  private async events(ctx: BotContext): Promise<Screen> {
    const feed = await this.readers.calendar.feed(ctx.userId, ctx.budgetId, {
      from: ctx.today,
      to: addDays(ctx.today, WEEK_DAYS - 1),
      includePlans: false,
    });
    const events = feed.items.flatMap((item) => (item.kind === 'EVENT' ? [item] : []));
    return {
      text: renderEvents(events, ctx.today),
      keyboard: rows(webButton(this.webBaseUrl, 'Календарь', '/app/calendar')),
    };
  }

  private async balance(ctx: BotContext): Promise<Screen> {
    const [accounts, summary] = await Promise.all([
      this.readers.accounts.list(ctx.userId, ctx.budgetId, 'active'),
      this.readers.dashboard.summary(ctx.userId, ctx.budgetId),
    ]);
    return {
      text: renderBalance(accounts, summary, ctx.today),
      keyboard: rows(webButton(this.webBaseUrl, 'Главная', '/app')),
    };
  }
}
```

Если TypeScript ругается на `views.push`, потому что тип массива выводится как `never[]`, объявить массив так: `const views: Awaited<ReturnType<BotReaders['plans']['calendar']>>[] = [];`.

- [ ] **Step 5: Маршрут в сервисе команд**

В `apps/api/src/telegram/bot/telegram-command.service.ts` три правки.

1. После строки `import type { StoredDialog, TelegramBotRepository } from './telegram-bot.repository.js';` добавить:

```ts
import type { BotViewRenderer } from './telegram-bot-views.js';
```

2. В конструкторе после `private readonly webBaseUrl: string,` добавить параметр:

```ts
    private readonly views: BotViewRenderer | null = null,
```

3. Строку

```ts
    // Read-only commands (task 6) go here.
```

заменить на:

```ts
    const view = this.views ? await this.views.render(command, ctx) : null;
    if (view) return this.show(ctx, null, null, view);
```

Цикл импортов (`telegram-bot-views.ts` импортирует тип `BotContext` из сервиса, а сервис — тип `BotViewRenderer`) существует только на уровне типов. Оба импорта — `import type`.

- [ ] **Step 6: Модуль**

В `apps/api/src/telegram/telegram.module.ts` две правки.

1. Добавить импорты, соблюдая алфавитный порядок путей, как в остальных импортах файла:

```ts
import { AccountApplicationService } from '../accounts/account.application.service.js';
import { AccountRepository } from '../accounts/account.repository.js';
import { DashboardV2ApplicationService } from '../v2-dashboard/dashboard-v2.application.service.js';
import { DashboardV2Repository } from '../v2-dashboard/dashboard-v2.repository.js';
import { JournalApplicationService } from '../v2-journal/journal.application.service.js';
import { JournalRepository } from '../v2-journal/journal.repository.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { TelegramBotViews } from './bot/telegram-bot-views.js';
```

2. В фабрике `TelegramCommandService` заменить строку

```ts
                  config.mail.webBaseUrl,
                )
              : null,
```

на:

```ts
                  config.mail.webBaseUrl,
                  new TelegramBotViews(
                    {
                      journal: new JournalApplicationService(
                        new TransactionRepository(prisma),
                        new JournalRepository(prisma),
                        new PlanModelPolicy(prisma),
                      ),
                      plans: new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
                      calendar: new CalendarApplicationService(
                        prisma,
                        new IdempotencyService(),
                        new PlanModelPolicy(prisma),
                        new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma)),
                      ),
                      accounts: new AccountApplicationService(new AccountRepository(prisma)),
                      dashboard: new DashboardV2ApplicationService(
                        prisma,
                        new PlanModelPolicy(prisma),
                        new DashboardV2Repository(prisma),
                      ),
                    },
                    new TelegramBotRepository(prisma),
                    config.mail.webBaseUrl,
                  ),
                )
              : null,
```

Перед этим сверить конструкторы с их модулями:
- `apps/api/src/v2-journal/journal.module.ts` — `JournalApplicationService(new TransactionRepository(prisma), new JournalRepository(prisma), new PlanModelPolicy(prisma))`;
- `apps/api/src/accounts/account.module.ts` — `AccountApplicationService(new AccountRepository(prisma))`;
- `apps/api/src/v2-dashboard/dashboard-v2.module.ts` — `DashboardV2ApplicationService(prisma, new PlanModelPolicy(prisma), new DashboardV2Repository(prisma))`. Третий аргумент имеет значение по умолчанию; если модуль передаёт его явно, передать так же.

- [ ] **Step 7: Интеграционный тест**

Файл `apps/api/test/telegram-bot-views.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const SECRET = 'webhook-secret-with-at-least-32-chars_';
const NBSP = '\u00a0';
const sent: Array<{ chatId: string; text: string }> = [];
const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { chat_id?: string; text?: string };
  if (body.chat_id && body.text) sent.push({ chatId: body.chat_id, text: body.text });
  return new Response('{"ok":true,"result":{"message_id":1}}', { status: 200 });
});

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;
let annaChat: number;
let borisChat: number;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

async function link(actor: FamilyActor): Promise<number> {
  const chatId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const now = new Date();
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: actor.user.id,
      chatId: BigInt(chatId),
      consentedAt: now,
      linkedAt: now,
      commandsEnabledAt: now,
      commandsConsentAt: now,
    },
  });
  return chatId;
}

async function ask(chatId: number, command: string): Promise<string> {
  const response = await env.server.inject({
    method: 'POST',
    url: '/api/v1/telegram/webhook',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    payload: JSON.stringify({
      update_id: Math.floor(Math.random() * 1e9),
      message: { message_id: 1, chat: { id: chatId, type: 'private' }, text: command },
    }),
  });
  expect(response.statusCode).toBe(200);
  const reply = sent.filter((item) => item.chatId === String(chatId)).at(-1);
  if (!reply) throw new Error('no reply');
  return reply.text;
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
  const card = await env.createAccount(anna, 'Карта Анны', '10000');
  await env.record(anna, { type: 'EXPENSE', accountId: card, amount: '1250.50' });
  await env.createAccount(boris, 'Секретный счёт Бориса', '999');
  const created = await env.inject(
    'POST',
    `/api/v2/budgets/${anna.budgetId}/calendar/events`,
    anna,
    { title: 'Родительское собрание', allDay: true, date: today(), recurrence: 'NONE' },
  );
  expect(created.statusCode).toBe(201);
  annaChat = await link(anna);
  borisChat = await link(boris);
});

afterAll(async () => {
  await env.stop();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sent.length = 0;
});

describe('read-only commands', () => {
  it('/last shows the confirmed expense of the budget only', async () => {
    const text = await ask(annaChat, '/last');
    expect(text).toContain('Последние операции');
    expect(text).toContain(`−1${NBSP}250,50${NBSP}₽`);
    expect(text).toContain('Карта Анны');
    expect(await ask(borisChat, '/last')).toContain('Операций пока нет');
  });

  it('/balance lists accounts with the dashboard total and never another family', async () => {
    const text = await ask(annaChat, '/balance');
    expect(text).toContain('Карта Анны');
    expect(text).toContain('Всего на счетах:');
    expect(text).not.toContain('Секретный счёт Бориса');
  });

  it('/events shows the event of today', async () => {
    const text = await ask(annaChat, '/events');
    expect(text).toContain('Родительское собрание');
    expect(text).toContain('весь день');
    expect(await ask(borisChat, '/events')).toContain('событий нет');
  });

  it('/plans answers even without plans', async () => {
    expect(await ask(borisChat, '/plans')).toContain('Плановые платежи');
  });

  it('views stay off while commands are switched off', async () => {
    await env.prisma.telegramLink.update({
      where: { chatId: BigInt(borisChat) },
      data: { commandsEnabledAt: null },
    });
    expect(await ask(borisChat, '/balance')).toContain('Команды бота выключены');
  });
});
```

Проверить по `apps/api/src/calendar/calendar.controller.ts`, что событие создаётся `POST /api/v2/budgets/:budgetId/calendar/events` и отвечает 201. Если код ответа другой (например 200), поправить ожидание в тесте и записать отступление.

- [ ] **Step 8: Проверки**

Run: `cd apps/api && pnpm exec vitest run src/telegram`
Expected: PASS.

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-bot-views.integration.test.ts test/telegram-bot-dialogs.integration.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm --filter @harmofin/api test`
Expected: PASS, 0 errors.

- [ ] **Step 9: Review по чек-листу**

Выполнить `git add apps/api/src/telegram apps/api/test/telegram-bot-views.integration.test.ts`, затем просмотреть `git diff --staged`.

- **security:**
  - каждый просмотр идёт через сервис с проверкой участия: `requireModel` и `findAccessibleWithRole`;
  - имена берутся с фильтром `budgetId`;
  - чужая семья не видна (тест с Борисом);
  - при выключенных командах просмотр закрыт;
  - всё экранируется.
- **financial:**
  - бот не суммирует деньги: «Всего» — это `cashMinor`, «Доступно» — `spendable`;
  - суммы форматируются из minor units строкой;
  - просроченные и ближайшие платежи не дублируются.
- **QA:** unit-тесты всех четырёх текстов и пустых состояний; интеграция `/last`, `/balance`, `/events`, `/plans` и изоляции.
- **final:**
  - сервисы созданы через `new`, как в их модулях;
  - нет повторного импорта модулей;
  - лишних файлов нет.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): команды просмотра операций, планов, событий и остатков"
```

Добавить строку в «Ход выполнения».
