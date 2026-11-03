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
  { type: 'text'; text: string } | { type: 'button'; action: string; index: number | null };

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
