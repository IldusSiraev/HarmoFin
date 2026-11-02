# Задача 2: клиент Bot API и разбор обновлений

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задача 1 закоммичена.

**Files:**
- Modify (полная замена): `apps/api/src/telegram/telegram-bot.client.ts`
- Modify: `apps/api/src/telegram/telegram-bot.client.test.ts`
- Modify (полная замена): `apps/api/src/telegram/telegram-update.ts`
- Modify: `apps/api/src/telegram/telegram-update.test.ts`
- Modify: `apps/api/src/telegram/telegram-link.application.service.ts` — временный ответ подсказкой на новые типы. В задаче 5 это место заменится делегированием в `TelegramCommandService`.

**Interfaces:**
- Consumes: ничего нового.
- Produces (используют задачи 4–6):
  - `TelegramCallbackButton = { text: string; callback_data: string }`;
  - `TelegramKeyboard = Array<Array<TelegramButton | TelegramCallbackButton>>`;
  - `TelegramBotClient`:
    - `sendMessage(chatId, text, buttons?) => Promise<void>` — как раньше;
    - `sendKeyboard(chatId: bigint, text: string, keyboard: TelegramKeyboard) => Promise<number | null>` — возвращает `message_id`;
    - `editKeyboard(chatId: bigint, messageId: number, text: string, keyboard: TelegramKeyboard) => Promise<void>` — ошибку `message is not modified` проглатывает;
    - `answerCallback(callbackId: string, text?: string) => Promise<void>`;
  - `TelegramUpdateAction` получает новые варианты:
    - `{ kind: 'command'; chatId: bigint; command: string }` — имя без `/` и `@бота`, в нижнем регистре;
    - `{ kind: 'text'; chatId: bigint; text: string }` — обрезано по краям, не длиннее 1000;
    - `{ kind: 'callback'; chatId: bigint; callbackId: string; messageId: number | null; data: string }`;
  - `BotInput = Extract<TelegramUpdateAction, { kind: 'command' | 'text' | 'callback' }>`.

`/start` и `/stop` разбираются как раньше. Сообщение без текста или с пустым текстом даёт `help`.

---

- [ ] **Step 1: Тесты клиента (падающие)**

В `apps/api/src/telegram/telegram-bot.client.test.ts` вставить этот блок перед строкой `describe('webButton', () => {`:

```ts
describe('HttpTelegramBotClient keyboards', () => {
  function respond(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }
  const keyboard = [
    [{ text: 'Да', callback_data: '1:ok' }],
    [{ text: 'Сайт', url: 'https://x.test' }],
  ];

  it('sends rows of callback and url buttons and returns the message id', async () => {
    const fetchImpl = respond(200, { ok: true, result: { message_id: 77 } });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    expect(await client.sendKeyboard(5n, 'Текст', keyboard)).toBe(77);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: '5',
      text: 'Текст',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  it('returns null when Telegram reports no message id', async () => {
    const client = new HttpTelegramBotClient(
      token,
      'https://api.telegram.org',
      respond(200, { ok: true, result: {} }),
    );
    expect(await client.sendKeyboard(5n, 'Текст', [])).toBeNull();
  });

  it('edits a message and tolerates "message is not modified"', async () => {
    const fetchImpl = respond(400, {
      ok: false,
      description: 'Bad Request: message is not modified: specified new message content',
    });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await expect(client.editKeyboard(5n, 9, 'Текст', keyboard)).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/editMessageText`);
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '5', message_id: 9 });
  });

  it('throws on any other edit error without the token', async () => {
    const client = new HttpTelegramBotClient(
      token,
      'https://api.telegram.org',
      respond(400, { ok: false, description: 'Bad Request: message to edit not found' }),
    );
    const error = await client.editKeyboard(5n, 9, 'Т', []).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramRequestError);
    expect(String((error as Error).message)).not.toContain(token);
  });

  it('answers a callback query with an optional notice', async () => {
    const fetchImpl = respond(200, { ok: true, result: true });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.answerCallback('cb-1', 'Устарело');
    await client.answerCallback('cb-2');
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as unknown,
    );
    expect(bodies).toEqual([
      { callback_query_id: 'cb-1', text: 'Устарело' },
      { callback_query_id: 'cb-2' },
    ]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd apps/api && pnpm exec vitest run src/telegram/telegram-bot.client.test.ts`
Expected: FAIL с `client.sendKeyboard is not a function`.

- [ ] **Step 3: Новый клиент**

Полностью заменить `apps/api/src/telegram/telegram-bot.client.ts`:

```ts
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
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/telegram-bot.client.test.ts`
Expected: PASS, 10 тестов. Старые тесты `sendMessage` тоже проходят: тело запроса не изменилось.

- [ ] **Step 4: Тесты разбора (падающие)**

В `apps/api/src/telegram/telegram-update.test.ts` найти тест

```ts
  it('answers any other private message with help', () => {
    expect(parseTelegramUpdate(message('привет'))).toEqual({ kind: 'help', chatId: 4242n });
    expect(parseTelegramUpdate(message(undefined))).toEqual({ kind: 'help', chatId: 4242n });
  });
```

и заменить его целиком на:

```ts
  it('reads other commands by name, lowercased, without the bot suffix or arguments', () => {
    expect(parseTelegramUpdate(message('/expense'))).toEqual({
      kind: 'command',
      chatId: 4242n,
      command: 'expense',
    });
    expect(parseTelegramUpdate(message('/Last@harmofin_bot 5'))).toEqual({
      kind: 'command',
      chatId: 4242n,
      command: 'last',
    });
  });

  it('passes plain text through, trimmed and capped at 1000 characters', () => {
    expect(parseTelegramUpdate(message('  1 250,50 '))).toEqual({
      kind: 'text',
      chatId: 4242n,
      text: '1 250,50',
    });
    const long = parseTelegramUpdate(message('я'.repeat(1_500)));
    expect(long).toMatchObject({ kind: 'text' });
    expect((long as { text: string }).text).toHaveLength(1_000);
  });

  it('answers a message without text or with blank text with help', () => {
    expect(parseTelegramUpdate(message(undefined))).toEqual({ kind: 'help', chatId: 4242n });
    expect(parseTelegramUpdate(message('   '))).toEqual({ kind: 'help', chatId: 4242n });
  });

  it('reads a pressed button of a private chat', () => {
    const update = {
      update_id: 5,
      callback_query: {
        id: 'cb-1',
        data: '3:acc:1',
        message: { message_id: 17, chat: privateChat },
      },
    };
    expect(parseTelegramUpdate(update)).toEqual({
      kind: 'callback',
      chatId: 4242n,
      callbackId: 'cb-1',
      messageId: 17,
      data: '3:acc:1',
    });
  });

  it('ignores buttons of groups and malformed callback queries', () => {
    const group = {
      update_id: 6,
      callback_query: {
        id: 'cb',
        data: 'x',
        message: { message_id: 1, chat: { id: -1, type: 'group' } },
      },
    };
    expect(parseTelegramUpdate(group)).toEqual({ kind: 'ignore' });
    expect(
      parseTelegramUpdate({
        update_id: 7,
        callback_query: { id: 'cb', message: { chat: privateChat } },
      }),
    ).toEqual({ kind: 'ignore' });
    expect(parseTelegramUpdate({ update_id: 8, callback_query: { id: 'cb', data: 'x' } })).toEqual({
      kind: 'ignore',
    });
  });
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/telegram-update.test.ts`
Expected: FAIL. Новые тесты получают `help` или `ignore` вместо `command`, `text` и `callback`.

- [ ] **Step 5: Новый разбор обновлений**

Полностью заменить `apps/api/src/telegram/telegram-update.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export type TelegramUpdateAction =
  | { kind: 'start'; chatId: bigint; code: string | null }
  | { kind: 'stop'; chatId: bigint }
  | { kind: 'help'; chatId: bigint }
  | { kind: 'command'; chatId: bigint; command: string }
  | { kind: 'text'; chatId: bigint; text: string }
  | {
      kind: 'callback';
      chatId: bigint;
      callbackId: string;
      messageId: number | null;
      data: string;
    }
  | { kind: 'blocked'; chatId: bigint }
  | { kind: 'ignore' };

export type BotInput = Extract<TelegramUpdateAction, { kind: 'command' | 'text' | 'callback' }>;

const START = /^\/start(?:\s+(\S+))?$/;
const STOP = /^\/stop$/;
// "/expense", "/expense@harmofin_bot" or "/expense anything": only the command name counts.
const COMMAND = /^\/([A-Za-z_]{1,32})(?:@\w+)?(?:\s[\s\S]*)?$/;
// Telegram deep-link payload: up to 64 characters of A-Z, a-z, 0-9, _ and -.
const CODE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 1_000;

function privateChatId(chat: unknown): bigint | null {
  if (!chat || typeof chat !== 'object') return null;
  const { id, type } = chat as { id?: unknown; type?: unknown };
  if (type !== 'private') return null;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  return BigInt(id);
}

function parseCallback(query: object): TelegramUpdateAction {
  const { id, data, message } = query as { id?: unknown; data?: unknown; message?: unknown };
  if (typeof id !== 'string' || typeof data !== 'string') return { kind: 'ignore' };
  if (!message || typeof message !== 'object') return { kind: 'ignore' };
  const { chat, message_id: messageId } = message as { chat?: unknown; message_id?: unknown };
  const chatId = privateChatId(chat);
  if (chatId === null) return { kind: 'ignore' };
  return {
    kind: 'callback',
    chatId,
    callbackId: id,
    messageId: typeof messageId === 'number' && Number.isSafeInteger(messageId) ? messageId : null,
    data,
  };
}

/**
 * Turns a raw Telegram Update into one bot action. Only private chats count; groups, channels and
 * every other update type are ignored without a reply.
 */
export function parseTelegramUpdate(update: unknown): TelegramUpdateAction {
  if (!update || typeof update !== 'object') return { kind: 'ignore' };
  const {
    message,
    my_chat_member: member,
    callback_query: callbackQuery,
  } = update as {
    message?: unknown;
    my_chat_member?: unknown;
    callback_query?: unknown;
  };

  if (callbackQuery && typeof callbackQuery === 'object') return parseCallback(callbackQuery);

  if (member && typeof member === 'object') {
    const { chat, new_chat_member: next } = member as {
      chat?: unknown;
      new_chat_member?: { status?: unknown };
    };
    const chatId = privateChatId(chat);
    if (chatId !== null && next?.status === 'kicked') return { kind: 'blocked', chatId };
    return { kind: 'ignore' };
  }

  if (message && typeof message === 'object') {
    const { chat, text } = message as { chat?: unknown; text?: unknown };
    const chatId = privateChatId(chat);
    if (chatId === null) return { kind: 'ignore' };
    if (typeof text !== 'string') return { kind: 'help', chatId };
    const trimmed = text.trim();
    const start = START.exec(trimmed);
    if (start) {
      const raw = start[1];
      return { kind: 'start', chatId, code: raw && CODE.test(raw) ? raw : null };
    }
    if (STOP.test(trimmed)) return { kind: 'stop', chatId };
    const command = COMMAND.exec(trimmed);
    if (command) return { kind: 'command', chatId, command: command[1]!.toLowerCase() };
    if (trimmed.length === 0) return { kind: 'help', chatId };
    return { kind: 'text', chatId, text: trimmed.slice(0, MAX_TEXT) };
  }

  return { kind: 'ignore' };
}

/** Constant-time comparison of the X-Telegram-Bot-Api-Secret-Token header. */
export function webhookSecretMatches(received: string | undefined, expected: string): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  const actual = createHash('sha256').update(received).digest();
  const wanted = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actual, wanted);
}
```

- [ ] **Step 6: Временная обработка новых типов в сервисе привязки**

В `apps/api/src/telegram/telegram-link.application.service.ts`, внутри `handleUpdate`, найти

```ts
      case 'help':
        return this.reply(action.chatId, BOT_REPLIES.help);
      case 'ignore':
```

и заменить на:

```ts
      case 'help':
      case 'command':
      case 'text':
        return this.reply(action.chatId, BOT_REPLIES.help);
      case 'callback':
      case 'ignore':
```

Тест «answers other messages with help» в `telegram-linking.integration.test.ts` по-прежнему проходит. Текст «привет» теперь приходит как `text` и получает ту же подсказку.

- [ ] **Step 7: Проверки**

Run: `cd apps/api && pnpm exec vitest run src/telegram`
Expected: PASS.

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-linking.integration.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --check apps/api/src/telegram`
Expected: PASS. Если упало, выполнить `pnpm exec prettier --write` на файлах задачи.

- [ ] **Step 8: Review по чек-листу**

Выполнить `git add apps/api/src/telegram/telegram-bot.client.ts apps/api/src/telegram/telegram-bot.client.test.ts apps/api/src/telegram/telegram-update.ts apps/api/src/telegram/telegram-update.test.ts apps/api/src/telegram/telegram-link.application.service.ts`, затем просмотреть `git diff --staged`.

- **security:**
  - URL с токеном не попадает в текст ошибок: `TelegramRequestError` содержит только статус;
  - нажатия кнопок из групп игнорируются;
  - текст ограничен 1000 символами.
- **QA:** покрыты `message_id` и его отсутствие, «not modified», прочие ошибки 400, тело `answerCallbackQuery`, команды с `@бот`, текст, пустой текст, `callback_query` из лички и из группы.
- **final:** `sendMessage` сохранил сигнатуру и тело запроса, лишних файлов нет.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): клавиатуры бота и разбор команд, текста и кнопок"
```

Добавить строку в «Ход выполнения».
