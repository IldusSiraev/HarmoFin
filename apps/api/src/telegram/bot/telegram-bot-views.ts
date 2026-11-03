import type { AccountApplicationService } from '../../accounts/account.application.service.js';
import type { CalendarApplicationService } from '../../calendar/calendar.application.service.js';
import { monthsOf } from '../../calendar/calendar-feed.js';
import { addDays } from '../../calendar/calendar-recurrence.js';
import type { PlansCalendarApplicationService } from '../../plans-calendar/plans-calendar.application.service.js';
import type { DashboardV2ApplicationService } from '../../v2-dashboard/dashboard-v2.application.service.js';
import type { JournalApplicationService } from '../../v2-journal/journal.application.service.js';
import { webButton, type TelegramButton, type TelegramKeyboard } from '../telegram-bot.client.js';
import {
  renderBalance,
  renderEvents,
  renderLast,
  renderPlans,
  type PlanLine,
} from './bot-views.js';
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
    const views: Awaited<ReturnType<BotReaders['plans']['calendar']>>[] = [];
    for (const month of monthsOf({ from: ctx.today, to })) {
      views.push(await this.readers.plans.calendar(ctx.userId, ctx.budgetId, { month }));
    }
    const line = (item: {
      occurrenceId: string;
      kind: 'OBLIGATION' | 'INCOME_PLAN';
      name: string;
      scheduledOn: string;
      unpaidMinor: string;
      expectedMinor: string;
    }): PlanLine => ({
      occurrenceId: item.occurrenceId,
      kind: item.kind,
      name: item.name,
      scheduledOn: item.scheduledOn,
      // Income plan occurrences always report unpaidMinor '0'; their amount is expectedMinor.
      amountMinor: item.kind === 'OBLIGATION' ? item.unpaidMinor : item.expectedMinor,
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
