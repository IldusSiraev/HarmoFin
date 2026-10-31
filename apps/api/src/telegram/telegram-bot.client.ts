export type TelegramButton = { text: string; url: string };

export interface TelegramBotClient {
  sendMessage(chatId: bigint, text: string, buttons?: TelegramButton[]): Promise<void>;
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

/** Minimal Bot API client for the bot's own replies. Plain fetch, no library. */
export class HttpTelegramBotClient implements TelegramBotClient {
  constructor(
    private readonly botToken: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(chatId: bigint, text: string, buttons: TelegramButton[] = []): Promise<void> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(buttons.length > 0
          ? { reply_markup: { inline_keyboard: buttons.map((button) => [button]) } }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new TelegramRequestError(response.status);
  }
}

/** Telegram accepts only https URLs in buttons; on a plain http web address there is no button. */
export function webButton(webBaseUrl: string, text: string, path: string): TelegramButton[] {
  if (!webBaseUrl.startsWith('https://')) return [];
  return [{ text, url: new URL(path, webBaseUrl).toString() }];
}
