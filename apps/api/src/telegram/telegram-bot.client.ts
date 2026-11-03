export type TelegramButton = { text: string; url: string };
export type TelegramCallbackButton = { text: string; callback_data: string };
/** Inline keyboard: rows of url or callback buttons. */
export type TelegramKeyboard = Array<Array<TelegramButton | TelegramCallbackButton>>;

export interface TelegramBotClient {
  sendMessage(chatId: bigint, text: string, buttons?: TelegramButton[]): Promise<void>;
  /** Sends a message with an inline keyboard; returns its message_id when Telegram reports one. */
  sendKeyboard(chatId: bigint, text: string, keyboard: TelegramKeyboard): Promise<number | null>;
  /** Replaces the text and keyboard of an earlier bot message; "not modified" is not an error. */
  editKeyboard(
    chatId: bigint,
    messageId: number,
    text: string,
    keyboard: TelegramKeyboard,
  ): Promise<void>;
  /** Stops the loading indicator of a pressed button, optionally with a short notice. */
  answerCallback(callbackId: string, text?: string): Promise<void>;
}

export const TELEGRAM_BOT_CLIENT = Symbol('TELEGRAM_BOT_CLIENT');

/** Carries only the HTTP status: the request URL contains the bot token and must never leak. */
export class TelegramRequestError extends Error {
  constructor(readonly status: number) {
    super(`Telegram request failed with status ${status}`);
    this.name = 'TelegramRequestError';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const NOT_MODIFIED = 'message is not modified';

type BotApiResponse = { ok?: boolean; description?: unknown; result?: unknown };

function markup(keyboard: TelegramKeyboard) {
  return keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {};
}

/** Minimal Bot API client for the bot's own replies. Plain fetch, no library. */
export class HttpTelegramBotClient implements TelegramBotClient {
  constructor(
    private readonly botToken: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(chatId: bigint, text: string, buttons: TelegramButton[] = []): Promise<void> {
    await this.sendKeyboard(
      chatId,
      text,
      buttons.map((button) => [button]),
    );
  }

  async sendKeyboard(
    chatId: bigint,
    text: string,
    keyboard: TelegramKeyboard,
  ): Promise<number | null> {
    const body = await this.call('sendMessage', {
      chat_id: chatId.toString(),
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...markup(keyboard),
    });
    const result = body.result as { message_id?: unknown } | undefined;
    return typeof result?.message_id === 'number' ? result.message_id : null;
  }

  async editKeyboard(
    chatId: bigint,
    messageId: number,
    text: string,
    keyboard: TelegramKeyboard,
  ): Promise<void> {
    await this.call(
      'editMessageText',
      {
        chat_id: chatId.toString(),
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...markup(keyboard),
      },
      NOT_MODIFIED,
    );
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text } : {}),
    });
  }

  private async call(
    method: string,
    payload: Record<string, unknown>,
    tolerated?: string,
  ): Promise<BotApiResponse> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as BotApiResponse;
    if (response.ok) return body;
    if (
      tolerated &&
      response.status === 400 &&
      typeof body.description === 'string' &&
      body.description.includes(tolerated)
    ) {
      return body;
    }
    throw new TelegramRequestError(response.status);
  }
}

/** Telegram accepts only https URLs in buttons; on a plain http web address there is no button. */
export function webButton(webBaseUrl: string, text: string, path: string): TelegramButton[] {
  if (!webBaseUrl.startsWith('https://')) return [];
  return [{ text, url: new URL(path, webBaseUrl).toString() }];
}
