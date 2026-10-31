export type TelegramButton = { text: string; url: string };
export type TelegramMessage = { text: string; buttons: TelegramButton[] };

export type BotApiResult =
  { ok: true } | { ok: false; status: number; description: string; retryAfter: number | null };

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * sendMessage over plain fetch. The request URL contains the bot token, so it never appears in
 * results or errors; network errors and timeouts are thrown as they are (their names only reach
 * logs) and retried by the delivery handler.
 */
export class TelegramBotApi {
  constructor(
    private readonly botToken: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(chatId: bigint, message: TelegramMessage): Promise<BotApiResult> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text: message.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(message.buttons.length > 0
          ? { reply_markup: { inline_keyboard: message.buttons.map((button) => [button]) } }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let body: {
      ok?: boolean;
      description?: unknown;
      parameters?: { retry_after?: unknown };
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Not JSON (proxy error page): the status is enough.
    }
    if (response.ok && body.ok !== false) return { ok: true };
    const retryAfter = body.parameters?.retry_after;
    return {
      ok: false,
      status: response.status,
      description: typeof body.description === 'string' ? body.description.slice(0, 200) : '',
      retryAfter: typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : null,
    };
  }
}
