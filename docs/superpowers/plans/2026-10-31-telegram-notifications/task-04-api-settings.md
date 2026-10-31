# Задача 4: API — настройки канала Telegram

Перед началом: прочитать [README](README.md). Задачи 1–3 закоммичены.

**Files:**
- Modify: `apps/api/src/telegram/telegram.repository.ts` — методы настроек.
- Create: `apps/api/src/telegram/telegram-settings.application.service.ts`
- Create: `apps/api/src/telegram/telegram-settings.application.service.test.ts`
- Create: `apps/api/src/telegram/telegram-settings.controller.ts`
- Modify: `apps/api/src/telegram/telegram.dto.ts` — DTO настроек.
- Modify: `apps/api/src/telegram/telegram.module.ts` — провайдер и контроллер.
- Create: `apps/api/test/telegram-settings.integration.test.ts`
- Modify: `openapi.json` (генерация).

**Interfaces:**
- Consumes (задача 3): `TelegramRepository` (`transaction`, `findLinkByUser(tx, userId) → {id} | null`, `audit(tx, userId, {entityType, entityId, action, values?, source, requestId?})`), `TelegramModule.register(config)`, `FamilyTestApp.start(overrides)`.
- Consumes (существующее): `updateEmailSettingsSchema` и тип `UpdateEmailSettingsInput` из `apps/api/src/notification-settings/notification-settings.schemas.ts` — тело `{enabled, urgentEnabled, digestFrequency, includeAmounts, amountsConsent?}` подходит и Telegram.
- Produces (используют задачи 7, 8):
  - `GET /api/v1/me/notification-settings/telegram` → 200 `TelegramSettingsView`.
  - `PUT /api/v1/me/notification-settings/telegram` → 200 `TelegramSettingsView`; 409 `TELEGRAM_NOT_LINKED`; 422 `AMOUNTS_CONSENT_REQUIRED`.
  - `type TelegramSettingsView = { available: boolean; linked: boolean; enabled: boolean; urgentEnabled: boolean; digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY'; includeAmounts: boolean; amountsConsentAt: string | null }`.

---

- [ ] **Step 1: Юнит-тест сервиса (падает)**

Файл `apps/api/src/telegram/telegram-settings.application.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import type { TelegramSettingValues } from './telegram.repository.js';

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback({})),
    findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1' }),
    findTelegramSetting: vi.fn().mockResolvedValue(null),
    upsertTelegramSetting: vi.fn(
      async (_tx: unknown, _userId: string, values: TelegramSettingValues) => ({
        id: 'setting-1',
        ...values,
      }),
    ),
    audit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const input = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as const,
  includeAmounts: false,
};

describe('TelegramSettingsApplicationService', () => {
  it('returns defaults with availability and link state', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, true);
    await expect(service.get('user-1')).resolves.toEqual({
      available: true,
      linked: true,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
  });

  it('refuses to enable the channel without a link', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.update('user-1', input, {})).rejects.toMatchObject({
      response: { code: 'TELEGRAM_NOT_LINKED' },
    });
    expect(repository.upsertTelegramSetting).not.toHaveBeenCalled();
  });

  it('refuses to enable the channel when the bot is not configured', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, false);
    await expect(service.update('user-1', input, {})).rejects.toMatchObject({
      response: { code: 'TELEGRAM_NOT_LINKED' },
    });
  });

  it('allows switching the channel off without a link', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.update('user-1', { ...input, enabled: false }, {})).resolves.toMatchObject({
      enabled: false,
      linked: false,
    });
  });

  it('asks for consent before amounts and audits the grant', async () => {
    const repository = makeRepository();
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(
      service.update('user-1', { ...input, includeAmounts: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'AMOUNTS_CONSENT_REQUIRED' } });

    const saved = await service.update(
      'user-1',
      { ...input, includeAmounts: true, amountsConsent: true },
      {},
    );
    expect(saved.amountsConsentAt).not.toBeNull();
    const actions = repository.audit.mock.calls.map((call) => (call[2] as { action: string }).action);
    expect(actions).toEqual(['UPDATED', 'AMOUNTS_CONSENT_GRANTED']);
    expect((repository.audit.mock.calls[0]![2] as { values: object }).values).toMatchObject({
      channel: 'TELEGRAM',
    });
  });

  it('clears the consent time when amounts are switched off', async () => {
    const repository = makeRepository({
      findTelegramSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: true,
        amountsConsentAt: new Date('2026-10-01'),
      }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const saved = await service.update('user-1', input, {});
    expect(saved.amountsConsentAt).toBeNull();
    const actions = repository.audit.mock.calls.map((call) => (call[2] as { action: string }).action);
    expect(actions).toEqual(['UPDATED', 'AMOUNTS_CONSENT_REVOKED']);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/telegram/telegram-settings.application.service.test.ts`
Expected: FAIL (модуля нет).

- [ ] **Step 2: Методы настроек в репозитории**

В `apps/api/src/telegram/telegram.repository.ts`:

1. Строку `import type { Prisma, UserStatus } from '@prisma/client';` заменить на `import type { DigestFrequency, Prisma, UserStatus } from '@prisma/client';`.

2. После `export type TelegramAuditSource = 'API' | 'TELEGRAM';` добавить:

```ts
export type TelegramSettingValues = {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: Date | null;
};

export type StoredTelegramSetting = TelegramSettingValues & { id: string };

const SETTING_SELECT = {
  id: true,
  enabled: true,
  urgentEnabled: true,
  digestFrequency: true,
  includeAmounts: true,
  amountsConsentAt: true,
} as const;
```

3. В класс `TelegramRepository` перед методом `audit` добавить:

```ts
  findTelegramSetting(tx: Tx, userId: string): Promise<StoredTelegramSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'TELEGRAM' } },
      select: SETTING_SELECT,
    });
  }

  upsertTelegramSetting(
    tx: Tx,
    userId: string,
    values: TelegramSettingValues,
  ): Promise<StoredTelegramSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'TELEGRAM' } },
      create: { id: createUuidV7(), userId, channel: 'TELEGRAM', ...values },
      update: values,
      select: SETTING_SELECT,
    });
  }
```

- [ ] **Step 3: Сервис настроек**

Файл `apps/api/src/telegram/telegram-settings.application.service.ts`:

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import type { UpdateEmailSettingsInput } from '../notification-settings/notification-settings.schemas.js';
import type {
  StoredTelegramSetting,
  TelegramRepository,
  TelegramSettingValues,
} from './telegram.repository.js';

type Meta = { requestId?: string };

export type TelegramSettingsView = {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
};

const DEFAULTS: TelegramSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

const AMOUNTS_CONSENT_MESSAGE = 'Подтвердите согласие на показ сумм в сообщениях Telegram.';

/**
 * Telegram channel settings of the signed-in user. Same rules as the email channel, with its own
 * amounts consent: the email consent does not cover Telegram. The channel can be switched on only
 * with a linked chat.
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
      return this.view(link !== null, setting ?? DEFAULTS);
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
      return this.view(link !== null, saved);
    });
  }

  private view(
    linked: boolean,
    setting: TelegramSettingValues | StoredTelegramSetting,
  ): TelegramSettingsView {
    return {
      available: this.available,
      linked,
      enabled: setting.enabled,
      urgentEnabled: setting.urgentEnabled,
      digestFrequency: setting.digestFrequency,
      includeAmounts: setting.includeAmounts,
      amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
    };
  }
}
```

Run: тест из Step 1. Expected: PASS.

- [ ] **Step 4: DTO**

В конец `apps/api/src/telegram/telegram.dto.ts` добавить:

```ts
const FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

export class TelegramNotificationSettingsResponse {
  @ApiProperty({ type: Boolean, description: 'Бот настроен на сервере.' })
  available!: boolean;

  @ApiProperty({ type: Boolean, description: 'Личный чат привязан; без этого канал не включить.' })
  linked!: boolean;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Просроченный платёж и напоминание календаря.' })
  urgentEnabled!: boolean;

  @ApiProperty({ type: String, enum: FREQUENCIES, description: 'В 08:00 по часовому поясу бюджета.' })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty({ type: Boolean })
  includeAmounts!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  amountsConsentAt!: string | null;
}

export class UpdateTelegramNotificationSettingsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean })
  urgentEnabled!: boolean;

  @ApiProperty({ type: String, enum: FREQUENCIES })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty({ type: Boolean })
  includeAmounts!: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Обязательно true, когда includeAmounts включается впервые.',
  })
  amountsConsent?: boolean;
}
```

- [ ] **Step 5: Контроллер**

Файл `apps/api/src/telegram/telegram-settings.controller.ts`:

```ts
import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  updateEmailSettingsSchema,
  type UpdateEmailSettingsInput,
} from '../notification-settings/notification-settings.schemas.js';
import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import {
  TelegramNotificationSettingsResponse,
  UpdateTelegramNotificationSettingsRequest,
} from './telegram.dto.js';

@ApiTags('notification-settings')
@Controller()
export class TelegramSettingsController {
  constructor(
    @Inject(TelegramSettingsApplicationService)
    private readonly service: TelegramSettingsApplicationService,
  ) {}

  @Get('me/notification-settings/telegram')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки уведомлений в Telegram',
    description:
      'Настройки текущего пользователя; если не сохранялись — значения по умолчанию (выключено). available — бот настроен на сервере, linked — чат привязан. Коды: 401.',
  })
  @ApiOkResponse({ type: TelegramNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    return this.service.get(requiredContext(request).userId);
  }

  @Put('me/notification-settings/telegram')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки уведомлений в Telegram',
    description:
      'Включить канал можно только с привязанным чатом. Включение сумм требует amountsConsent: true (своё согласие, не общее с почтой). Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 TELEGRAM_NOT_LINKED, 422 AMOUNTS_CONSENT_REQUIRED.',
  })
  @ApiBody({ type: UpdateTelegramNotificationSettingsRequest })
  @ApiOkResponse({ type: TelegramNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updateEmailSettingsSchema)) input: UpdateEmailSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const meta = requestMeta(request);
    return this.service.update(
      requiredContext(request).userId,
      input,
      meta.requestId ? { requestId: meta.requestId } : {},
    );
  }
}
```

- [ ] **Step 6: Регистрация в модуле**

В `apps/api/src/telegram/telegram.module.ts`:
- импорты: `import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';` и `import { TelegramSettingsController } from './telegram-settings.controller.js';`;
- `controllers: [TelegramLinkController, TelegramWebhookController]` заменить на `controllers: [TelegramLinkController, TelegramWebhookController, TelegramSettingsController]`;
- в `providers` добавить последним элементом:

```ts
        {
          provide: TelegramSettingsApplicationService,
          useFactory: (repository: TelegramRepository) =>
            new TelegramSettingsApplicationService(repository, config.telegram !== undefined),
          inject: [TelegramRepository],
        },
```

- [ ] **Step 7: Интеграционный тест**

Файл `apps/api/test/telegram-settings.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const path = '/api/v1/me/notification-settings/telegram';
const body = { enabled: true, urgentEnabled: true, digestFrequency: 'WEEKLY', includeAmounts: false };
let anna: FamilyActor;
let boris: FamilyActor;

beforeAll(async () => {
  await env.start({
    TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
    TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
    TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  });
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

describe('telegram notification settings', () => {
  it('returns defaults with the bot available and no link', async () => {
    const response = await env.inject('GET', path, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: true,
      linked: false,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
  });

  it('refuses to enable the channel without a linked chat', async () => {
    const response = await env.inject('PUT', path, anna, body);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_NOT_LINKED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: path,
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
  });

  it('saves settings with a linked chat and keeps a separate amounts consent', async () => {
    const now = new Date();
    await env.prisma.telegramLink.create({
      data: {
        id: randomUUID(),
        userId: anna.user.id,
        chatId: BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000)),
        consentedAt: now,
        linkedAt: now,
      },
    });
    const saved = await env.inject('PUT', path, anna, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ linked: true, enabled: true, digestFrequency: 'WEEKLY' });

    const noConsent = await env.inject('PUT', path, anna, { ...body, includeAmounts: true });
    expect(noConsent.statusCode).toBe(422);
    expect(noConsent.json()).toMatchObject({ code: 'AMOUNTS_CONSENT_REQUIRED' });

    const consent = await env.inject('PUT', path, anna, {
      ...body,
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json().amountsConsentAt).not.toBeNull();

    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'AMOUNTS_CONSENT_GRANTED' },
    });
    expect(audit?.newValues).toEqual({ channel: 'TELEGRAM' });
  });

  it('does not touch the email channel', async () => {
    const email = await env.inject('GET', '/api/v1/me/notification-settings/email', anna);
    expect(email.json()).toMatchObject({ enabled: false, includeAmounts: false });
  });

  it('keeps settings per user', async () => {
    expect((await env.inject('GET', path, boris)).json()).toMatchObject({
      linked: false,
      enabled: false,
    });
  });
});
```

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-settings.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: OpenAPI и общие проверки**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && node scripts/openapi/check.mjs openapi.json`
Expected: появился путь `/api/v1/me/notification-settings/telegram` (get, put); без строк `lint:`.

Run: `pnpm --filter @harmofin/api test && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS, 0 errors.

- [ ] **Step 9: Review по чек-листу**

`git add apps/api/src/telegram apps/api/test/telegram-settings.integration.test.ts openapi.json` и `git diff --staged`:

- security: оба маршрута под сессией, `PUT` под CSRF; согласие на суммы своё у Telegram (аудит с `channel: 'TELEGRAM'`); без привязки или бота канал не включается.
- API: схема ответа и запроса описана; коды 409/422 в описании; путь только добавлен.
- QA: юнит-тесты на 409 (нет привязки, нет бота), выключение без привязки, согласие и отзыв; интеграция — CSRF, независимость от email, раздельность пользователей.
- final: файлы почты (`notification-settings/*`) не изменены.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): настройки канала Telegram в API"
```

Добавить строку в «Ход выполнения» README.
