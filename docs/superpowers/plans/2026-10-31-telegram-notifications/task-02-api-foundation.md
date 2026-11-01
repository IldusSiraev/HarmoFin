# Задача 2: основа API — конфиг, исключение из OriginGuard, клиент Bot API, разбор обновлений

Перед началом: прочитать [README](README.md). Задача 1 закоммичена.

**Files:**
- Modify: `apps/api/src/config/env.ts` — переменные `TELEGRAM_*`, поле `telegram` в `ApiConfig`.
- Create: `apps/api/src/config/env.telegram.test.ts`
- Create: `apps/api/src/common/security/external-webhook.decorator.ts`
- Modify: `apps/api/src/common/security/origin.guard.ts`
- Modify: `apps/api/src/app.ts:56`
- Create: `apps/api/src/common/security/external-webhook.test.ts`
- Create: `apps/api/src/telegram/telegram-bot.client.ts`, `apps/api/src/telegram/telegram-bot.client.test.ts`
- Create: `apps/api/src/telegram/telegram-update.ts`, `apps/api/src/telegram/telegram-update.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces (используют задачи 3, 4, 8):
  - `ApiConfig.telegram?: ApiTelegramConfig`, где `ApiTelegramConfig = { botToken: string; botUsername: string; webhookSecret: string; apiBaseUrl: string }`. Поле есть, только если заданы все три `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
  - `ExternalWebhook(): MethodDecorator` и константа `EXTERNAL_WEBHOOK` из `common/security/external-webhook.decorator.ts`.
  - `TELEGRAM_BOT_CLIENT: symbol`, `interface TelegramBotClient { sendMessage(chatId: bigint, text: string, buttons?: TelegramButton[]): Promise<void> }`, `class HttpTelegramBotClient`, `class TelegramRequestError`, `type TelegramButton = { text: string; url: string }`, `webButton(webBaseUrl, text, path): TelegramButton[]` из `telegram/telegram-bot.client.ts`.
  - `parseTelegramUpdate(update: unknown): TelegramUpdateAction`, `webhookSecretMatches(received: string | undefined, expected: string): boolean` из `telegram/telegram-update.ts`.

---

- [ ] **Step 1: Тест конфига (падает)**

Файл `apps/api/src/config/env.telegram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};

const telegram = {
  TELEGRAM_BOT_TOKEN: '123456:test-token-value-abcdef',
  TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
};

describe('loadApiConfig telegram', () => {
  it('leaves telegram out when no variable is set', () => {
    expect(loadApiConfig(base).telegram).toBeUndefined();
  });

  it('treats empty strings as not set', () => {
    const config = loadApiConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    });
    expect(config.telegram).toBeUndefined();
  });

  it('maps a complete telegram configuration with the default API base URL', () => {
    expect(loadApiConfig({ ...base, ...telegram }).telegram).toEqual({
      botToken: '123456:test-token-value-abcdef',
      botUsername: 'harmofin_test_bot',
      webhookSecret: 'webhook-secret-with-at-least-32-chars_',
      apiBaseUrl: 'https://api.telegram.org',
    });
  });

  it('accepts a custom API base URL without a trailing slash', () => {
    const config = loadApiConfig({
      ...base,
      ...telegram,
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9/',
    });
    expect(config.telegram?.apiBaseUrl).toBe('http://127.0.0.1:9');
  });

  it('rejects a partial telegram configuration', () => {
    expect(() =>
      loadApiConfig({ ...base, TELEGRAM_BOT_TOKEN: telegram.TELEGRAM_BOT_TOKEN }),
    ).toThrow(/TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET/);
  });

  it('rejects a short or unsafe webhook secret', () => {
    expect(() =>
      loadApiConfig({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: 'short' }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() =>
      loadApiConfig({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: `${'a'.repeat(32)}!` }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('rejects an invalid bot username', () => {
    expect(() =>
      loadApiConfig({ ...base, ...telegram, TELEGRAM_BOT_USERNAME: '@bad name' }),
    ).toThrow(/TELEGRAM_BOT_USERNAME/);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/config/env.telegram.test.ts`
Expected: FAIL (`telegram` нет в конфиге).

- [ ] **Step 2: Реализовать конфиг**

В `apps/api/src/config/env.ts`:

1. В `apiEnvironmentSchema` после строки `RATE_LIMIT_RECOVERY_MAX: ...` добавить:

```ts
  TELEGRAM_BOT_TOKEN: optionalNonEmptyString,
  TELEGRAM_BOT_USERNAME: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/)
        .optional(),
    ),
  TELEGRAM_WEBHOOK_SECRET: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,256}$/)
        .optional(),
    ),
  TELEGRAM_API_BASE_URL: httpUrl.default('https://api.telegram.org'),
```

2. Перед `export interface ApiConfig` добавить:

```ts
export interface ApiTelegramConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  apiBaseUrl: string;
}
```

3. В `interface ApiConfig` после блока `rateLimit: { ... };` добавить:

```ts
  /** Present only when the bot token, username and webhook secret are all set. */
  telegram?: ApiTelegramConfig;
```

4. В `loadApiConfig` перед `return {` добавить:

```ts
  const telegramValues = [
    ['TELEGRAM_BOT_TOKEN', environment.TELEGRAM_BOT_TOKEN],
    ['TELEGRAM_BOT_USERNAME', environment.TELEGRAM_BOT_USERNAME],
    ['TELEGRAM_WEBHOOK_SECRET', environment.TELEGRAM_WEBHOOK_SECRET],
  ] as const;
  const missingTelegram = telegramValues.filter(([, value]) => !value).map(([name]) => name);
  if (missingTelegram.length > 0 && missingTelegram.length < telegramValues.length) {
    throw new Error(`Invalid API configuration: ${missingTelegram.join(', ')}`);
  }
```

5. В объекте, который возвращает `loadApiConfig`, после блока `rateLimit: { ... },` добавить:

```ts
    ...(missingTelegram.length === 0
      ? {
          telegram: {
            botToken: environment.TELEGRAM_BOT_TOKEN!,
            botUsername: environment.TELEGRAM_BOT_USERNAME!,
            webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET!,
            apiBaseUrl: environment.TELEGRAM_API_BASE_URL.replace(/\/+$/, ''),
          },
        }
      : {}),
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/config`
Expected: PASS (новый файл и старый `env.test.ts`).

- [ ] **Step 3: Тест исключения из OriginGuard (падает)**

Файл `apps/api/src/common/security/external-webhook.test.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ExternalWebhook } from './external-webhook.decorator.js';
import { OriginGuard } from './origin.guard.js';

const config = { webOrigin: 'http://localhost:3000' } as never;

class Handlers {
  @ExternalWebhook()
  webhook(): void {}

  regular(): void {}
}

function contextFor(handler: () => void, headers: Record<string, string> = {}): never {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', headers }) }),
    getHandler: () => handler,
    getClass: () => Handlers,
  } as never;
}

describe('ExternalWebhook', () => {
  it('lets a POST without Origin reach a webhook route', () => {
    const guard = new OriginGuard(config);
    expect(guard.canActivate(contextFor(Handlers.prototype.webhook))).toBe(true);
  });

  it('still rejects a POST without Origin on a regular route', () => {
    const guard = new OriginGuard(config);
    expect(() => guard.canActivate(contextFor(Handlers.prototype.regular))).toThrow(
      ForbiddenException,
    );
  });

  it('still accepts the web origin on a regular route', () => {
    const guard = new OriginGuard(config);
    expect(
      guard.canActivate(
        contextFor(Handlers.prototype.regular, { origin: 'http://localhost:3000' }),
      ),
    ).toBe(true);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/common/security/external-webhook.test.ts`
Expected: FAIL (модуля `external-webhook.decorator.js` нет).

- [ ] **Step 4: Декоратор и правка OriginGuard**

Файл `apps/api/src/common/security/external-webhook.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const EXTERNAL_WEBHOOK = 'harmofin:external-webhook';

/**
 * Marks a route called by an external service (Telegram) that sends no Origin header. The global
 * OriginGuard skips such a route; the route must authenticate the caller itself (secret header).
 */
export const ExternalWebhook = (): MethodDecorator => SetMetadata(EXTERNAL_WEBHOOK, true);
```

Файл `apps/api/src/common/security/origin.guard.ts` заменить целиком:

```ts
import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import type { ApiConfig } from '../../config/env.js';
import { EXTERNAL_WEBHOOK } from './external-webhook.decorator.js';
import { API_CONFIG, UNSAFE_HTTP_METHODS } from './security.constants.js';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!UNSAFE_HTTP_METHODS.has(request.method)) return true;
    if (this.isExternalWebhook(context)) return true;

    if (request.headers.origin !== this.config.webOrigin) {
      throw new ForbiddenException({
        code: 'ORIGIN_REQUIRED',
        detail: 'Источник запроса не разрешен.',
      });
    }

    return true;
  }

  private isExternalWebhook(context: ExecutionContext): boolean {
    // Unit tests build a bare context without a handler.
    const handler = typeof context.getHandler === 'function' ? context.getHandler() : undefined;
    return handler !== undefined && this.reflector.get<boolean>(EXTERNAL_WEBHOOK, handler) === true;
  }
}
```

В `apps/api/src/app.ts`:
- добавить `Reflector` в импорт: строку `import { NestFactory } from '@nestjs/core';` заменить на `import { NestFactory, Reflector } from '@nestjs/core';`;
- строку `app.useGlobalGuards(new OriginGuard(config));` заменить на `app.useGlobalGuards(new OriginGuard(config, app.get(Reflector)));`.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/common/security`
Expected: PASS (новый файл и старый `security.guards.test.ts`).

- [ ] **Step 5: Тест разбора обновлений (падает)**

Файл `apps/api/src/telegram/telegram-update.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseTelegramUpdate, webhookSecretMatches } from './telegram-update.js';

const privateChat = { id: 4242, type: 'private' };
const message = (text: unknown, chat: object = privateChat) => ({
  update_id: 1,
  message: { message_id: 1, chat, text },
});

describe('parseTelegramUpdate', () => {
  it('reads /start with a code', () => {
    expect(parseTelegramUpdate(message('/start abc_DEF-123'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: 'abc_DEF-123',
    });
  });

  it('reads /start without a code or with an invalid code as code null', () => {
    expect(parseTelegramUpdate(message('/start'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
    expect(parseTelegramUpdate(message('/start bad!code'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
    expect(parseTelegramUpdate(message(`/start ${'a'.repeat(65)}`))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
  });

  it('reads /stop', () => {
    expect(parseTelegramUpdate(message('/stop'))).toEqual({ kind: 'stop', chatId: 4242n });
  });

  it('answers any other private message with help', () => {
    expect(parseTelegramUpdate(message('привет'))).toEqual({ kind: 'help', chatId: 4242n });
    expect(parseTelegramUpdate(message(undefined))).toEqual({ kind: 'help', chatId: 4242n });
  });

  it('ignores groups, channels and malformed chats', () => {
    expect(parseTelegramUpdate(message('/start abc', { id: -100, type: 'group' }))).toEqual({
      kind: 'ignore',
    });
    expect(parseTelegramUpdate(message('/start abc', { id: 'x', type: 'private' }))).toEqual({
      kind: 'ignore',
    });
    expect(parseTelegramUpdate({ update_id: 2 })).toEqual({ kind: 'ignore' });
    expect(parseTelegramUpdate(null)).toEqual({ kind: 'ignore' });
  });

  it('reads a blocked bot from my_chat_member', () => {
    const update = {
      update_id: 3,
      my_chat_member: { chat: privateChat, new_chat_member: { status: 'kicked' } },
    };
    expect(parseTelegramUpdate(update)).toEqual({ kind: 'blocked', chatId: 4242n });
  });

  it('ignores other membership changes', () => {
    const update = {
      update_id: 4,
      my_chat_member: { chat: privateChat, new_chat_member: { status: 'member' } },
    };
    expect(parseTelegramUpdate(update)).toEqual({ kind: 'ignore' });
  });
});

describe('webhookSecretMatches', () => {
  const secret = 'webhook-secret-with-at-least-32-chars_';

  it('accepts the exact secret only', () => {
    expect(webhookSecretMatches(secret, secret)).toBe(true);
    expect(webhookSecretMatches(`${secret}x`, secret)).toBe(false);
    expect(webhookSecretMatches('', secret)).toBe(false);
    expect(webhookSecretMatches(undefined, secret)).toBe(false);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/telegram/telegram-update.test.ts`
Expected: FAIL (модуля нет).

- [ ] **Step 6: Реализовать разбор обновлений**

Файл `apps/api/src/telegram/telegram-update.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export type TelegramUpdateAction =
  | { kind: 'start'; chatId: bigint; code: string | null }
  | { kind: 'stop'; chatId: bigint }
  | { kind: 'help'; chatId: bigint }
  | { kind: 'blocked'; chatId: bigint }
  | { kind: 'ignore' };

const START = /^\/start(?:\s+(\S+))?$/;
const STOP = /^\/stop$/;
// Telegram deep-link payload: up to 64 characters of A-Z, a-z, 0-9, _ and -.
const CODE = /^[A-Za-z0-9_-]{1,64}$/;

function privateChatId(chat: unknown): bigint | null {
  if (!chat || typeof chat !== 'object') return null;
  const { id, type } = chat as { id?: unknown; type?: unknown };
  if (type !== 'private') return null;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  return BigInt(id);
}

/**
 * Turns a raw Telegram Update into the one action the bot supports. Only private chats count;
 * groups, channels and every other update type are ignored without a reply.
 */
export function parseTelegramUpdate(update: unknown): TelegramUpdateAction {
  if (!update || typeof update !== 'object') return { kind: 'ignore' };
  const { message, my_chat_member: member } = update as {
    message?: unknown;
    my_chat_member?: unknown;
  };

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
    return { kind: 'help', chatId };
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

Run: тот же тест. Expected: PASS.

- [ ] **Step 7: Тест клиента Bot API (падает)**

Файл `apps/api/src/telegram/telegram-bot.client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { HttpTelegramBotClient, TelegramRequestError, webButton } from './telegram-bot.client.js';

const token = '123456:secret-token-value';

function fakeFetch(status: number) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: status === 200 }), { status }));
}

describe('HttpTelegramBotClient', () => {
  it('posts sendMessage as HTML with buttons and no link preview', async () => {
    const fetchImpl = fakeFetch(200);
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.sendMessage(4242n, '<b>Привет</b>', [{ text: 'Открыть', url: 'https://x.test/a' }]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '4242',
      text: '<b>Привет</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://x.test/a' }]] },
    });
  });

  it('omits reply_markup without buttons', async () => {
    const fetchImpl = fakeFetch(200);
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.sendMessage(1n, 'text');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('reply_markup');
  });

  it('throws a status-only error that never contains the token', async () => {
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fakeFetch(403));
    const error = await client.sendMessage(1n, 'text').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramRequestError);
    expect((error as TelegramRequestError).status).toBe(403);
    expect(String((error as Error).message)).not.toContain(token);
  });
});

describe('webButton', () => {
  it('builds an absolute https button', () => {
    expect(webButton('https://harmofin.example', 'Настройки', '/app/settings/telegram')).toEqual([
      { text: 'Настройки', url: 'https://harmofin.example/app/settings/telegram' },
    ]);
  });

  it('returns no button for a non-https web address', () => {
    expect(webButton('http://localhost:3000', 'Настройки', '/app/settings/telegram')).toEqual([]);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/telegram/telegram-bot.client.test.ts`
Expected: FAIL (модуля нет).

- [ ] **Step 8: Реализовать клиент**

Файл `apps/api/src/telegram/telegram-bot.client.ts`:

```ts
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
```

Run: тот же тест. Expected: PASS.

- [ ] **Step 9: Общие проверки**

Run: `pnpm --filter @harmofin/api test`
Expected: PASS.
Run: `pnpm --filter @harmofin/api typecheck`
Expected: PASS.
Run: `pnpm --filter @harmofin/api lint`
Expected: 0 errors.

- [ ] **Step 10: Review по чек-листу**

`git add apps/api/src/config apps/api/src/common/security apps/api/src/app.ts apps/api/src/telegram` и `git diff --staged`:

- security: исключение из `OriginGuard` срабатывает только при метаданных `EXTERNAL_WEBHOOK`; обычные маршруты по-прежнему требуют origin веба (тест есть); сравнение секрета — `timingSafeEqual` по хешам одинаковой длины; в тексте ошибки клиента нет токена; конфиг Telegram «всё или ничего».
- API: контракт ещё не меняется (маршрутов нет), `openapi.json` не трогали.
- QA: тесты покрывают частичный конфиг, короткий секрет, группы, `kicked`, невалидный код, ошибку без токена.
- final: нет новых зависимостей; ничего вне перечисленных файлов.

- [ ] **Step 11: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): конфиг API, исключение webhook из OriginGuard, клиент Bot API"
```

Добавить строку в «Ход выполнения» README.
