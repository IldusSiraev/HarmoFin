# Задача 4: переключатели по типу в API email и Telegram

Перед началом прочитать [README](README.md). Ветка — `feat/calendar-multiple-reminders`. Задачи 1–3 закоммичены.

**Files:**
- Modify: `apps/api/src/notification-settings/notification-settings.schemas.ts`
- Modify: `apps/api/src/notification-settings/notification-settings.repository.ts`
- Modify: `apps/api/src/notification-settings/notification-settings.application.service.ts`
- Modify: `apps/api/src/notification-settings/notification-settings.dto.ts`
- Modify: `apps/api/src/notification-settings/notification-settings.application.service.test.ts`
- Modify: `apps/api/src/telegram/telegram.repository.ts`
- Modify: `apps/api/src/telegram/telegram-settings.application.service.ts`
- Modify: `apps/api/src/telegram/telegram.dto.ts`
- Modify: `apps/api/src/telegram/telegram-settings.application.service.test.ts`
- Modify: `apps/api/test/notification-settings.integration.test.ts`
- Modify: `apps/api/test/telegram-settings.integration.test.ts`
- Modify: `openapi.json` (генерируется).

**Interfaces:**
- Consumes (задача 3): worker уже проверяет `planOverdueEnabled` и `calendarReminderEnabled` в каждом канале. Колонки есть в `notification_channel_settings` с `main`.
- Produces (используют задача 6):
  - `GET` и `PUT /api/v1/me/notification-settings/email`, `GET` и `PUT /api/v1/me/notification-settings/telegram` отдают `planOverdueEnabled: boolean` и `calendarReminderEnabled: boolean`;
  - во входе `PUT` оба поля необязательны (`planOverdueEnabled?: boolean`, `calendarReminderEnabled?: boolean`). Если поле не пришло, сохраняется текущее значение, а без строки настроек — `true`;
  - аудит `UPDATED` канала получает оба значения.

Telegram использует ту же zod-схему, что email (`updateEmailSettingsSchema`), поэтому поля входа добавляются один раз.

---

- [ ] **Step 1: Падающие unit-тесты email**

В `apps/api/src/notification-settings/notification-settings.application.service.test.ts`:

1. В тесте `returns defaults with a masked address when nothing is stored` в объекте `toEqual` после строки `      amountsConsentAt: null,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

2. В тесте `keeps the original consent moment while amounts stay on and clears it when turned off` в объекте `findEmailSetting` после строки `        amountsConsentAt: consentAt,` добавить:

```ts
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
```

3. Перед тестом `unsubscribes by the hash of the token and ignores unknown tokens` добавить:

```ts
  it('saves the per-type switches when given and keeps the stored ones when omitted', async () => {
    const repository = makeRepository({
      findEmailSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: false,
        amountsConsentAt: null,
        planOverdueEnabled: true,
        calendarReminderEnabled: false,
      }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);

    const kept = await service.updateEmail('user-1', input, {});
    expect(repository.upsertEmailSetting.mock.calls[0]![2]).toMatchObject({
      planOverdueEnabled: true,
      calendarReminderEnabled: false,
    });
    expect(kept).toMatchObject({ planOverdueEnabled: true, calendarReminderEnabled: false });

    await service.updateEmail('user-1', { ...input, planOverdueEnabled: false }, {});
    expect(repository.upsertEmailSetting.mock.calls[1]![2]).toMatchObject({
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
    expect(repository.audit.mock.calls[1]![2].values).toMatchObject({
      channel: 'EMAIL',
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
  });

  it('switches the types on by default for a first save without them', async () => {
    const repository = makeRepository();
    const service = new NotificationSettingsApplicationService(repository as never);
    await service.updateEmail('user-1', input, {});
    expect(repository.upsertEmailSetting.mock.calls[0]![2]).toMatchObject({
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
    });
  });
```

- [ ] **Step 2: Падающие unit-тесты Telegram**

В `apps/api/src/telegram/telegram-settings.application.service.test.ts`:

1. В тесте, где `service.get('user-1')` сравнивается через `toEqual` (около строки 33), после строки `      amountsConsentAt: null,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

2. В тесте `clears the consent time when amounts are switched off`, в объекте `findTelegramSetting`, после строки `        amountsConsentAt: new Date('2026-10-01'),` добавить `        planOverdueEnabled: true,` и `        calendarReminderEnabled: true,`. В `makeRepository` мок `findTelegramSetting` возвращает `null`, а `upsertTelegramSetting` — `{ id, ...values }`: их не трогать.

3. В конец блока `describe('TelegramSettingsApplicationService', () => { ... })` (первый `describe` файла, до `describe('TelegramSettingsApplicationService.setCommands'`), перед его закрывающей `});`, добавить тест:

```ts
  it('saves the per-type switches when given and keeps the stored ones when omitted', async () => {
    const repository = makeRepository({
      findTelegramSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: false,
        amountsConsentAt: null,
        planOverdueEnabled: false,
        calendarReminderEnabled: true,
      }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);

    const kept = await service.update('user-1', input, {});
    expect(kept).toMatchObject({ planOverdueEnabled: false, calendarReminderEnabled: true });

    await service.update('user-1', { ...input, calendarReminderEnabled: false }, {});
    expect(repository.upsertTelegramSetting.mock.calls[1]![2]).toMatchObject({
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
    const audits = repository.audit.mock.calls.map((call) => call[2] as { values?: unknown });
    expect(audits.at(-1)?.values).toMatchObject({
      channel: 'TELEGRAM',
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
  });
```

- [ ] **Step 3: Запустить и увидеть падение**

```bash
cd apps/api && pnpm exec vitest run src/notification-settings src/telegram/telegram-settings.application.service.test.ts
```

Ожидается: FAIL — в ответе и в сохраняемых значениях нет новых полей.

- [ ] **Step 4: Схема входа**

`apps/api/src/notification-settings/notification-settings.schemas.ts`, в `updateEmailSettingsSchema` после строки `    amountsConsent: z.boolean().optional(),` добавить:

```ts
    // Optional so an older client does not reset them; absent means "keep the stored value".
    planOverdueEnabled: z.boolean().optional(),
    calendarReminderEnabled: z.boolean().optional(),
```

- [ ] **Step 5: Email — репозиторий и сервис**

В `apps/api/src/notification-settings/notification-settings.repository.ts`:

1. В `EmailSettingValues` после строки `  amountsConsentAt: Date | null;` добавить:

```ts
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
```

2. В обоих `select` (в `findEmailSetting` и в `upsertEmailSetting`) после строки `        amountsConsentAt: true,` добавить:

```ts
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
```

В `apps/api/src/notification-settings/notification-settings.application.service.ts`:

1. В `EmailSettingsView` после `  amountsConsentAt: string | null;` добавить:

```ts
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
```

2. В `DEFAULTS` после `  amountsConsentAt: null,` добавить:

```ts
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
```

3. В `updateEmail`, в объекте `values`, после блока `amountsConsentAt: ...` (он заканчивается строкой `            : (current?.amountsConsentAt ?? new Date()),`) добавить:

```ts
        planOverdueEnabled:
          input.planOverdueEnabled ?? current?.planOverdueEnabled ?? DEFAULTS.planOverdueEnabled,
        calendarReminderEnabled:
          input.calendarReminderEnabled ??
          current?.calendarReminderEnabled ??
          DEFAULTS.calendarReminderEnabled,
```

4. В аудите `UPDATED` (объект `values` с `channel: 'EMAIL'`) после строки `          includeAmounts: values.includeAmounts,` добавить:

```ts
          planOverdueEnabled: values.planOverdueEnabled,
          calendarReminderEnabled: values.calendarReminderEnabled,
```

5. В функции `view` после строки `    amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,` добавить:

```ts
    planOverdueEnabled: setting.planOverdueEnabled,
    calendarReminderEnabled: setting.calendarReminderEnabled,
```

- [ ] **Step 6: Telegram — репозиторий и сервис**

В `apps/api/src/telegram/telegram.repository.ts`:

1. В `TelegramSettingValues` после `  amountsConsentAt: Date | null;` добавить:

```ts
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
```

2. В `SETTING_SELECT` после `  amountsConsentAt: true,` добавить:

```ts
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
```

В `apps/api/src/telegram/telegram-settings.application.service.ts` — те же пять правок, что в шаге 5 для email:

1. `TelegramSettingsView`: после `  amountsConsentAt: string | null;` добавить `planOverdueEnabled: boolean;` и `calendarReminderEnabled: boolean;`.
2. `DEFAULTS`: после `  amountsConsentAt: null,` добавить `planOverdueEnabled: true,` и `calendarReminderEnabled: true,`.
3. В `update`, в объекте `values`, после строки `            : (current?.amountsConsentAt ?? new Date()),` добавить:

```ts
        planOverdueEnabled:
          input.planOverdueEnabled ?? current?.planOverdueEnabled ?? DEFAULTS.planOverdueEnabled,
        calendarReminderEnabled:
          input.calendarReminderEnabled ??
          current?.calendarReminderEnabled ??
          DEFAULTS.calendarReminderEnabled,
```

4. В аудите `UPDATED` (объект `values` с `channel: 'TELEGRAM'`) после `          includeAmounts: values.includeAmounts,` добавить:

```ts
          planOverdueEnabled: values.planOverdueEnabled,
          calendarReminderEnabled: values.calendarReminderEnabled,
```

5. В методе `view` после строки `      amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,` добавить:

```ts
      planOverdueEnabled: setting.planOverdueEnabled,
      calendarReminderEnabled: setting.calendarReminderEnabled,
```

`setCommands` вызывает `this.view(next, setting ?? DEFAULTS)` и после правки тоже отдаёт новые поля. Больше ничего не меняется.

- [ ] **Step 7: DTO**

В `apps/api/src/notification-settings/notification-settings.dto.ts`:

1. В `EmailNotificationSettingsResponse` после поля `amountsConsentAt` добавить:

```ts

  @ApiProperty({ type: Boolean, description: 'Срочное письмо о просроченном платеже.' })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Срочное письмо с напоминанием календаря.' })
  calendarReminderEnabled!: boolean;
```

2. В `UpdateEmailNotificationSettingsRequest` после поля `amountsConsent` добавить:

```ts

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Если не передано, значение не меняется; по умолчанию true.',
  })
  planOverdueEnabled?: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Если не передано, значение не меняется; по умолчанию true.',
  })
  calendarReminderEnabled?: boolean;
```

В `apps/api/src/telegram/telegram.dto.ts`:

1. В `TelegramNotificationSettingsResponse` после поля `amountsConsentAt` (перед `commandsEnabled`) добавить:

```ts

  @ApiProperty({ type: Boolean, description: 'Срочное сообщение о просроченном платеже.' })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Срочное сообщение с напоминанием календаря.' })
  calendarReminderEnabled!: boolean;
```

2. В `UpdateTelegramNotificationSettingsRequest` после поля `amountsConsent` добавить те же два необязательных поля, что в `UpdateEmailNotificationSettingsRequest` выше.

- [ ] **Step 8: Unit-тесты зелёные**

```bash
cd apps/api && pnpm exec vitest run src/notification-settings src/telegram
pnpm typecheck
```

Ожидается: PASS.

- [ ] **Step 9: Интеграционные тесты**

В `apps/api/test/notification-settings.integration.test.ts`:

1. В тесте `returns defaults and a masked address` в объекте `toMatchObject` после `      amountsConsentAt: null,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

2. Перед тестом `keeps settings per user` добавить:

```ts
  it('switches a type off, keeps it on a save without the field and audits it', async () => {
    const off = await env.inject('PUT', path, anna, { ...body, calendarReminderEnabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ planOverdueEnabled: true, calendarReminderEnabled: false });

    const kept = await env.inject('PUT', path, anna, body);
    expect(kept.json()).toMatchObject({ calendarReminderEnabled: false });

    const row = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'EMAIL' } },
    });
    expect(row).toMatchObject({ planOverdueEnabled: true, calendarReminderEnabled: false });

    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'UPDATED', entityType: 'notification_settings' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(audit?.newValues).toMatchObject({ channel: 'EMAIL', calendarReminderEnabled: false });
  });
```

Этот тест идёт после `saves settings once verified and asks for consent before amounts`, где у `anna` уже подтверждена почта и канал включён. `NotificationSettingsRepository.audit` пишет `entityType: 'notification_settings'`.

В `apps/api/test/telegram-settings.integration.test.ts`:

1. В тесте `returns defaults with the bot available and no link` в объекте `toEqual` после `      amountsConsentAt: null,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

2. Перед тестом `does not touch the email channel` добавить:

```ts
  it('switches a type off for Telegram only and keeps it on a save without the field', async () => {
    const off = await env.inject('PUT', path, anna, { ...body, planOverdueEnabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ planOverdueEnabled: false, calendarReminderEnabled: true });

    const kept = await env.inject('PUT', path, anna, body);
    expect(kept.json()).toMatchObject({ planOverdueEnabled: false });

    const email = await env.inject('GET', '/api/v1/me/notification-settings/email', anna);
    expect(email.json()).toMatchObject({ planOverdueEnabled: true });
  });
```

Этот тест идёт после `saves settings with a linked chat and keeps a separate amounts consent`: у `anna` уже привязан чат.

```bash
cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/notification-settings.integration.test.ts test/telegram-settings.integration.test.ts test/telegram-commands-settings.integration.test.ts test/email-delivery.integration.test.ts test/telegram-delivery.integration.test.ts
```

Ожидается: PASS.

- [ ] **Step 10: OpenAPI**

```bash
node scripts/openapi/generate.mjs
pnpm exec prettier --write openapi.json
node scripts/openapi/check.mjs openapi.json
git diff --stat openapi.json
```

Ожидается: `check.mjs` без `lint:`. Новые поля входа необязательны, поэтому `breaking change` нет.

- [ ] **Step 11: Проверки и stage**

```bash
pnpm --filter @harmofin/api test
pnpm typecheck
pnpm lint
cd apps/api && pnpm exec prettier --check src/notification-settings src/telegram test/notification-settings.integration.test.ts test/telegram-settings.integration.test.ts && cd ../..
git add apps/api/src/notification-settings apps/api/src/telegram/telegram.repository.ts apps/api/src/telegram/telegram-settings.application.service.ts apps/api/src/telegram/telegram.dto.ts apps/api/src/telegram/telegram-settings.application.service.test.ts apps/api/test/notification-settings.integration.test.ts apps/api/test/telegram-settings.integration.test.ts openapi.json
git status --short
```

**Review:** API (поля необязательны, совместимость старого клиента, OpenAPI), security (настройки только своего пользователя, аудит без адреса и `chat_id`), QA (сохранение при отсутствии поля, значения по умолчанию, независимость каналов), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(notifications): переключатели типов срочных уведомлений для email и Telegram"
```
