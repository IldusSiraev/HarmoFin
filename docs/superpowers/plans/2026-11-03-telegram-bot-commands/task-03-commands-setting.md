# Задача 3: настройка команд бота в API

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–2 закоммичены.

**Files:**
- Modify: `apps/api/src/telegram/telegram.repository.ts` — `findLinkByUser` отдаёт `commandsEnabledAt`; новый метод `setCommands`.
- Modify: `apps/api/src/telegram/telegram.schemas.ts` — `updateTelegramCommandsSchema`.
- Modify (полная замена): `apps/api/src/telegram/telegram-settings.application.service.ts` — поле `commandsEnabled`, метод `setCommands`.
- Modify: `apps/api/src/telegram/telegram.dto.ts` — поле ответа и тело запроса.
- Modify: `apps/api/src/telegram/telegram-settings.controller.ts` — `PUT me/notification-settings/telegram/commands`.
- Modify: `apps/api/src/telegram/telegram-settings.application.service.test.ts`
- Modify: `apps/api/test/telegram-settings.integration.test.ts` — в ожидании по умолчанию добавляется `commandsEnabled: false`.
- Create: `apps/api/test/telegram-commands-settings.integration.test.ts`
- Modify: `openapi.json` (генерируется).

**Interfaces:**
- Consumes (задача 1): `telegramLink.commandsEnabledAt`, `telegramLink.commandsConsentAt`, `telegramDialog.chatId`.
- Produces (используют задачи 5 и 7):
  - `TelegramSettingsView` получает `commandsEnabled: boolean`;
  - `PUT /api/v1/me/notification-settings/telegram/commands`:
    - тело — `{ enabled: boolean; consent?: boolean }`;
    - ответ 200 — та же форма, что у `GET`;
    - ошибки — 400 `VALIDATION_FAILED`, 401, 403 `CSRF_INVALID`, 409 `TELEGRAM_UNAVAILABLE`, 409 `TELEGRAM_NOT_LINKED`, 422 `TELEGRAM_COMMANDS_CONSENT_REQUIRED` с `fieldErrors[0].field = 'consent'`;
  - аудит: `entityType: 'telegram_link'`, действия `TELEGRAM_COMMANDS_ENABLED` и `TELEGRAM_COMMANDS_DISABLED`, источник `API`, без значений;
  - выключение удаляет открытый диалог чата.

Правила:
- Включение впервые требует `consent: true`.
- Повторное `enabled: true` для уже включённых команд проходит без согласия и ничего не меняет.
- Выключение обнуляет обе метки времени.
- Метки хранятся в самой привязке, поэтому новая привязка (`createLink`) начинается с выключенных команд, а `refreshLink` того же чата их не трогает.

---

- [ ] **Step 1: Unit-тесты сервиса (падающие)**

В `apps/api/src/telegram/telegram-settings.application.service.test.ts` три правки.

1. В `makeRepository` после строки `audit: vi.fn().mockResolvedValue(undefined),` добавить:

```ts
    setCommands: vi.fn().mockResolvedValue(undefined),
```

2. В тесте `returns defaults with availability and link state` в ожидаемый объект после `amountsConsentAt: null,` добавить:

```ts
      commandsEnabled: false,
```

3. В конец файла, после последней `});`, добавить:

```ts

describe('TelegramSettingsApplicationService.setCommands', () => {
  const enabledLink = { id: 'link-1', commandsEnabledAt: new Date('2026-11-01') };

  it('refuses when the bot is not configured', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, false);
    await expect(
      service.setCommands('user-1', { enabled: true, consent: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'TELEGRAM_UNAVAILABLE' } });
  });

  it('refuses without a linked chat', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(
      service.setCommands('user-1', { enabled: true, consent: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'TELEGRAM_NOT_LINKED' } });
  });

  it('asks for consent before switching commands on', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1', commandsEnabledAt: null }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.setCommands('user-1', { enabled: true }, {})).rejects.toMatchObject({
      response: {
        code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED',
        fieldErrors: [{ field: 'consent' }],
      },
    });
    expect(repository.setCommands).not.toHaveBeenCalled();
  });

  it('switches commands on with consent and audits it', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1', commandsEnabledAt: null }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands(
      'user-1',
      { enabled: true, consent: true },
      { requestId: 'req-1' },
    );
    expect(view.commandsEnabled).toBe(true);
    const values = repository.setCommands.mock.calls[0]![2] as {
      commandsEnabledAt: Date;
      commandsConsentAt: Date;
    };
    expect(values.commandsEnabledAt).toBeInstanceOf(Date);
    expect(values.commandsConsentAt).toEqual(values.commandsEnabledAt);
    expect(repository.audit.mock.calls[0]![2]).toEqual({
      entityType: 'telegram_link',
      entityId: 'link-1',
      action: 'TELEGRAM_COMMANDS_ENABLED',
      source: 'API',
      requestId: 'req-1',
    });
  });

  it('keeps enabled commands as they are without a new consent', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue(enabledLink),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands('user-1', { enabled: true }, {});
    expect(view.commandsEnabled).toBe(true);
    expect(repository.setCommands).not.toHaveBeenCalled();
    expect(repository.audit).not.toHaveBeenCalled();
  });

  it('switches commands off and clears both times', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue(enabledLink),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands('user-1', { enabled: false }, {});
    expect(view.commandsEnabled).toBe(false);
    expect(repository.setCommands.mock.calls[0]![2]).toEqual({
      commandsEnabledAt: null,
      commandsConsentAt: null,
    });
    expect((repository.audit.mock.calls[0]![2] as { action: string }).action).toBe(
      'TELEGRAM_COMMANDS_DISABLED',
    );
  });
});
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/telegram-settings.application.service.test.ts`
Expected: FAIL: `service.setCommands is not a function` и нет поля `commandsEnabled`.

- [ ] **Step 2: Репозиторий**

В `apps/api/src/telegram/telegram.repository.ts` метод

```ts
  findLinkByUser(tx: Tx, userId: string) {
    return tx.telegramLink.findUnique({ where: { userId }, select: { id: true } });
  }
```

заменить на:

```ts
  findLinkByUser(tx: Tx, userId: string) {
    return tx.telegramLink.findUnique({
      where: { userId },
      select: { id: true, commandsEnabledAt: true },
    });
  }

  /** Switches bot commands on (with the consent time) or off; switching off ends the open dialog. */
  async setCommands(
    tx: Tx,
    linkId: string,
    values: { commandsEnabledAt: Date | null; commandsConsentAt: Date | null },
  ): Promise<void> {
    const link = await tx.telegramLink.update({
      where: { id: linkId },
      data: values,
      select: { chatId: true },
    });
    if (values.commandsEnabledAt === null) {
      await tx.telegramDialog.deleteMany({ where: { chatId: link.chatId } });
    }
  }
```

`findLinkByUser` использует и `TelegramLinkApplicationService.issueLink`. Там читается только `id`, поэтому новое поле ничего не ломает.

- [ ] **Step 3: Схема тела**

В конец `apps/api/src/telegram/telegram.schemas.ts` добавить:

```ts

export const updateTelegramCommandsSchema = z
  .object({ enabled: z.boolean(), consent: z.boolean().optional() })
  .strict();

export type UpdateTelegramCommandsInput = z.infer<typeof updateTelegramCommandsSchema>;
```

- [ ] **Step 4: Сервис настроек**

Полностью заменить `apps/api/src/telegram/telegram-settings.application.service.ts`:

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import type { UpdateEmailSettingsInput } from '../notification-settings/notification-settings.schemas.js';
import type { UpdateTelegramCommandsInput } from './telegram.schemas.js';
import type {
  StoredTelegramSetting,
  TelegramRepository,
  TelegramSettingValues,
} from './telegram.repository.js';

type Meta = { requestId?: string };
type LinkState = { id: string; commandsEnabledAt: Date | null } | null;

export type TelegramSettingsView = {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
  commandsEnabled: boolean;
};

const DEFAULTS: TelegramSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

const AMOUNTS_CONSENT_MESSAGE = 'Подтвердите согласие на показ сумм в сообщениях Telegram.';
const COMMANDS_CONSENT_MESSAGE = 'Подтвердите согласие на включение команд бота.';

/**
 * Telegram channel settings of the signed-in user. Same rules as the email channel, with its own
 * amounts consent: the email consent does not cover Telegram. The channel can be switched on only
 * with a linked chat. Bot commands have a separate switch and consent stored on the link itself,
 * so a new chat always starts with commands off.
 */
export class TelegramSettingsApplicationService {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly available: boolean,
  ) {}

  get(userId: string): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByUser(tx, userId);
      const setting = await this.repository.findTelegramSetting(tx, userId);
      return this.view(link, setting ?? DEFAULTS);
    });
  }

  update(
    userId: string,
    input: UpdateEmailSettingsInput,
    meta: Meta,
  ): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByUser(tx, userId);
      if (input.enabled && (!this.available || !link)) {
        throw new ConflictException({
          code: 'TELEGRAM_NOT_LINKED',
          detail: 'Сначала подключите Telegram.',
        });
      }
      const current = await this.repository.findTelegramSetting(tx, userId);
      const hadAmounts = current?.includeAmounts ?? false;
      const grantsAmounts = input.includeAmounts && !hadAmounts;
      if (grantsAmounts && input.amountsConsent !== true) {
        throw new UnprocessableEntityException({
          code: 'AMOUNTS_CONSENT_REQUIRED',
          detail: AMOUNTS_CONSENT_MESSAGE,
          fieldErrors: [
            { field: 'includeAmounts', message: AMOUNTS_CONSENT_MESSAGE, code: 'custom' },
          ],
        });
      }
      const values: TelegramSettingValues = {
        enabled: input.enabled,
        urgentEnabled: input.urgentEnabled,
        digestFrequency: input.digestFrequency,
        includeAmounts: input.includeAmounts,
        amountsConsentAt: !input.includeAmounts
          ? null
          : grantsAmounts
            ? new Date()
            : (current?.amountsConsentAt ?? new Date()),
      };
      const saved = await this.repository.upsertTelegramSetting(tx, userId, values);
      const requestId = meta.requestId ? { requestId: meta.requestId } : {};
      await this.repository.audit(tx, userId, {
        entityType: 'notification_settings',
        entityId: saved.id,
        action: 'UPDATED',
        values: {
          channel: 'TELEGRAM',
          enabled: values.enabled,
          urgentEnabled: values.urgentEnabled,
          digestFrequency: values.digestFrequency,
          includeAmounts: values.includeAmounts,
        },
        source: 'API',
        ...requestId,
      });
      if (grantsAmounts || (hadAmounts && !input.includeAmounts)) {
        await this.repository.audit(tx, userId, {
          entityType: 'notification_settings',
          entityId: saved.id,
          action: grantsAmounts ? 'AMOUNTS_CONSENT_GRANTED' : 'AMOUNTS_CONSENT_REVOKED',
          values: { channel: 'TELEGRAM' },
          source: 'API',
          ...requestId,
        });
      }
      return this.view(link, saved);
    });
  }

  /** Bot commands need a linked chat; switching them on the first time needs consent: true. */
  setCommands(
    userId: string,
    input: UpdateTelegramCommandsInput,
    meta: Meta,
  ): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      if (!this.available) {
        throw new ConflictException({
          code: 'TELEGRAM_UNAVAILABLE',
          detail: 'Telegram-бот не подключён на сервере.',
        });
      }
      const link = await this.repository.findLinkByUser(tx, userId);
      if (!link) {
        throw new ConflictException({
          code: 'TELEGRAM_NOT_LINKED',
          detail: 'Сначала подключите Telegram.',
        });
      }
      const wasEnabled = link.commandsEnabledAt !== null;
      if (input.enabled && !wasEnabled && input.consent !== true) {
        throw new UnprocessableEntityException({
          code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED',
          detail: COMMANDS_CONSENT_MESSAGE,
          fieldErrors: [{ field: 'consent', message: COMMANDS_CONSENT_MESSAGE, code: 'custom' }],
        });
      }
      let next: LinkState = link;
      if (input.enabled !== wasEnabled) {
        const now = new Date();
        const values = input.enabled
          ? { commandsEnabledAt: now, commandsConsentAt: now }
          : { commandsEnabledAt: null, commandsConsentAt: null };
        await this.repository.setCommands(tx, link.id, values);
        await this.repository.audit(tx, userId, {
          entityType: 'telegram_link',
          entityId: link.id,
          action: input.enabled ? 'TELEGRAM_COMMANDS_ENABLED' : 'TELEGRAM_COMMANDS_DISABLED',
          source: 'API',
          ...(meta.requestId ? { requestId: meta.requestId } : {}),
        });
        next = { id: link.id, commandsEnabledAt: values.commandsEnabledAt };
      }
      const setting = await this.repository.findTelegramSetting(tx, userId);
      return this.view(next, setting ?? DEFAULTS);
    });
  }

  private view(
    link: LinkState,
    setting: TelegramSettingValues | StoredTelegramSetting,
  ): TelegramSettingsView {
    return {
      available: this.available,
      linked: link !== null,
      enabled: setting.enabled,
      urgentEnabled: setting.urgentEnabled,
      digestFrequency: setting.digestFrequency,
      includeAmounts: setting.includeAmounts,
      amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
      commandsEnabled: (link?.commandsEnabledAt ?? null) !== null,
    };
  }
}
```

Run: `cd apps/api && pnpm exec vitest run src/telegram/telegram-settings.application.service.test.ts`
Expected: PASS.

- [ ] **Step 5: DTO**

В `apps/api/src/telegram/telegram.dto.ts` внутри класса `TelegramNotificationSettingsResponse`, после

```ts
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  amountsConsentAt!: string | null;
```

добавить:

```ts

  @ApiProperty({
    type: Boolean,
    description: 'Команды бота включены для привязанного чата; без привязки всегда false.',
  })
  commandsEnabled!: boolean;
```

В конец файла добавить:

```ts

export class UpdateTelegramCommandsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Обязательно true при включении: ответы бота с суммами и названиями остаются в истории чата, из чата можно проводить операции.',
  })
  consent?: boolean;
}
```

- [ ] **Step 6: Контроллер**

В `apps/api/src/telegram/telegram-settings.controller.ts` две правки.

1. Импорты привести к виду:

```ts
import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import {
  TelegramNotificationSettingsResponse,
  UpdateTelegramCommandsRequest,
  UpdateTelegramNotificationSettingsRequest,
} from './telegram.dto.js';
import {
  updateTelegramCommandsSchema,
  type UpdateTelegramCommandsInput,
} from './telegram.schemas.js';
```

2. В класс после метода `update(...) { ... }` добавить метод:

```ts

  @Put('me/notification-settings/telegram/commands')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Включить или выключить команды Telegram-бота',
    description:
      'Только с привязанным чатом. Включение впервые требует consent: true: ответы бота с суммами и названиями остаются в истории чата, из чата можно проводить операции от имени пользователя. Выключение прерывает начатый в чате ввод. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 TELEGRAM_UNAVAILABLE, 409 TELEGRAM_NOT_LINKED, 422 TELEGRAM_COMMANDS_CONSENT_REQUIRED.',
  })
  @ApiBody({ type: UpdateTelegramCommandsRequest })
  @ApiOkResponse({ type: TelegramNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  setCommands(
    @Body(new ZodValidationPipe(updateTelegramCommandsSchema)) input: UpdateTelegramCommandsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const meta = requestMeta(request);
    return this.service.setCommands(
      requiredContext(request).userId,
      input,
      meta.requestId ? { requestId: meta.requestId } : {},
    );
  }
```

- [ ] **Step 7: Старый интеграционный тест настроек**

В `apps/api/test/telegram-settings.integration.test.ts` в тесте `returns defaults with the bot available and no link` в ожидаемый объект после `amountsConsentAt: null,` добавить:

```ts
      commandsEnabled: false,
```

- [ ] **Step 8: Интеграционный тест эндпоинта**

Файл `apps/api/test/telegram-commands-settings.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const settingsPath = '/api/v1/me/notification-settings/telegram';
const commandsPath = `${settingsPath}/commands`;
let anna: FamilyActor;
let boris: FamilyActor;
let annaChat: bigint;

beforeAll(async () => {
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
  const now = new Date();
  annaChat = BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000));
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      chatId: annaChat,
      consentedAt: now,
      linkedAt: now,
    },
  });
});

afterAll(async () => {
  await env.stop();
});

const linkOf = () => env.prisma.telegramLink.findUniqueOrThrow({ where: { chatId: annaChat } });

describe('PUT /api/v1/me/notification-settings/telegram/commands', () => {
  it('starts with commands off', async () => {
    const response = await env.inject('GET', settingsPath, anna);
    expect(response.json()).toMatchObject({ linked: true, commandsEnabled: false });
  });

  it('refuses without a linked chat', async () => {
    const response = await env.inject('PUT', commandsPath, boris, { enabled: true, consent: true });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_NOT_LINKED' });
  });

  it('requires consent to switch commands on', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED' });
    expect((await linkOf()).commandsEnabledAt).toBeNull();
  });

  it('rejects unknown fields', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true, extra: 1 });
    expect(response.statusCode).toBe(400);
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: commandsPath,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: { enabled: true, consent: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it('switches commands on with consent and audits it without the chat id', async () => {
    const response = await env.inject('PUT', commandsPath, anna, { enabled: true, consent: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ linked: true, commandsEnabled: true });
    const link = await linkOf();
    expect(link.commandsEnabledAt).not.toBeNull();
    expect(link.commandsConsentAt).toEqual(link.commandsEnabledAt);
    const audit = await env.prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: anna.user.id, action: 'TELEGRAM_COMMANDS_ENABLED' },
    });
    expect(audit.entityId).toBe(link.id);
    expect(JSON.stringify(audit)).not.toContain(annaChat.toString());
  });

  it('switches commands off and ends the open dialog', async () => {
    await env.prisma.telegramDialog.create({
      data: {
        id: randomUUID(),
        chatId: annaChat,
        userId: anna.user.id,
        budgetId: anna.budgetId,
        kind: 'EXPENSE',
        step: 'amount',
        expiresAt: new Date(Date.now() + 1_800_000),
      },
    });
    const response = await env.inject('PUT', commandsPath, anna, { enabled: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ commandsEnabled: false });
    const link = await linkOf();
    expect(link.commandsEnabledAt).toBeNull();
    expect(link.commandsConsentAt).toBeNull();
    expect(await env.prisma.telegramDialog.findUnique({ where: { chatId: annaChat } })).toBeNull();
  });
});
```

- [ ] **Step 9: OpenAPI**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && node scripts/openapi/check.mjs openapi.json`
Expected:
- в `openapi.json` появился путь `/api/v1/me/notification-settings/telegram/commands` с методом `put`;
- в `TelegramNotificationSettingsResponse` появилось поле `commandsEnabled`;
- `check.mjs` завершился без `lint:`.

- [ ] **Step 10: Проверки**

Run: `cd apps/api && pnpm exec vitest run src/telegram`
Expected: PASS.

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-commands-settings.integration.test.ts test/telegram-settings.integration.test.ts test/telegram-linking.integration.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm --filter @harmofin/api test`
Expected: PASS, включая `di-explicit-inject.test.ts`.

- [ ] **Step 11: Review по чек-листу**

Выполнить `git add apps/api/src/telegram apps/api/test/telegram-settings.integration.test.ts apps/api/test/telegram-commands-settings.integration.test.ts openapi.json`, затем просмотреть `git diff --staged`.

- **security:**
  - включение невозможно без привязки и без `consent: true`;
  - выключение удаляет диалог;
  - в аудите нет `chat_id` и значений;
  - эндпоинт защищён сессией и CSRF.
- **API:**
  - изменения только добавляют;
  - все коды ошибок описаны в `description` и в `@ApiResponse`;
  - тело `.strict()`.
- **QA:**
  - покрыты 409 (нет бота, нет привязки), 422, 400, 403, включение, повторное включение без согласия, выключение;
  - старые тесты обновлены только на новое поле.
- **final:**
  - `issueLink` и `update` ведут себя по-прежнему;
  - `openapi.json` пересобран, а не правлен руками.

- [ ] **Step 12: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): включение команд бота с отдельным согласием"
```

Добавить строку в «Ход выполнения».
