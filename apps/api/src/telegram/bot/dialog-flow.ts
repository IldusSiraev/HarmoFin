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
      return title.length > 0 && title.length <= TITLE_MAX
        ? forward({ title })
        : stay(ERRORS.title);
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
      if (state.step === 'account')
        return forward({ accountId: choice.id, accountName: choice.label });
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
      const reminder =
        event.action === 'rem' && event.index !== null ? REMINDERS[event.index] : null;
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
