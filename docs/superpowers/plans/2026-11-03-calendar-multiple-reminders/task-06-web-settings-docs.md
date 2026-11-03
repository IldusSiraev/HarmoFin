# Задача 6: чекбоксы типов в настройках email и Telegram, E2E, документация

Перед началом прочитать [README](README.md) и [Calm Fintech visual guidelines](../../specs/2026-09-17-calm-fintech-visual-guidelines.md). Ветка — `feat/calendar-multiple-reminders`. Задачи 1–5 закоммичены.

**Files:**
- Modify: `apps/web/app/composables/useNotificationSettings.ts` — типы.
- Modify: `apps/web/app/pages/app/settings/notifications.vue`
- Modify: `apps/web/app/pages/app/settings/telegram.vue`
- Modify: `apps/web/app/pages/app/settings/notifications.test.ts`
- Modify: `apps/web/app/pages/app/settings/telegram.test.ts`
- Modify: `e2e/family-calendar.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`
- Modify: `docs/superpowers/specs/2026-10-30-family-calendar-design.md`
- Modify: `docs/superpowers/specs/2026-11-03-calendar-multiple-reminders-design.md` — статус.
- Modify: `README.md`

**Interfaces:**
- Consumes (задача 4): ответы `GET` и `PUT` email и Telegram содержат `planOverdueEnabled` и `calendarReminderEnabled`; во входе `PUT` оба поля необязательны.
- Consumes (задача 5): чипы напоминаний с подписями «За 1 день», «За 1 час», строка карточки «За 1 день, за 1 час».
- Produces: на `/app/settings/notifications` и `/app/settings/telegram`, когда включены срочные, виден блок `role="group"` с двумя чекбоксами:
  - `name="planOverdueEnabled"`, подпись «Просроченные платежи»;
  - `name="calendarReminderEnabled"`, подпись «Напоминания календаря».

  Страница всегда отправляет оба поля. Если срочные выключены, блок скрыт, а значения сохраняются в форме и отправляются как есть.

---

- [ ] **Step 1: Типы**

В `apps/web/app/composables/useNotificationSettings.ts`:

1. В `EmailNotificationSettings` после `  amountsConsentAt: string | null;` добавить:

```ts
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
```

2. В `EmailNotificationSettingsInput` после `  amountsConsent?: boolean;` добавить:

```ts
  planOverdueEnabled?: boolean;
  calendarReminderEnabled?: boolean;
```

3. В `TelegramNotificationSettings` после `  amountsConsentAt: string | null;` добавить:

```ts
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
```

`TelegramNotificationSettingsInput` — это `EmailNotificationSettingsInput`, его не трогать.

- [ ] **Step 2: Падающие тесты страницы email**

В `apps/web/app/pages/app/settings/notifications.test.ts`:

1. В объекте `verified` после строки `  amountsConsentAt: null,` добавить:

```ts
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
```

2. В тесте `asks for consent before showing amounts and sends it with the save` в объекте `toHaveBeenCalledWith` после строки `      amountsConsent: true,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

3. Перед тестом `shows a server error` добавить:

```ts
  it('offers the urgent types and sends them with the save', async () => {
    api.getEmail.mockResolvedValue({ ...verified, calendarReminderEnabled: false });
    const wrapper = await mountPage();
    const group = wrapper.get('[role="group"][aria-label="Какие срочные письма присылать"]');
    expect(group.text()).toContain('Просроченные платежи');
    expect(group.text()).toContain('Напоминания календаря');
    const reminders = wrapper.get('[name="calendarReminderEnabled"]');
    expect((reminders.element as HTMLInputElement).checked).toBe(false);

    await wrapper.get('[name="planOverdueEnabled"]').setValue(false);
    await reminders.setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveEmail).toHaveBeenCalledWith(
      expect.objectContaining({ planOverdueEnabled: false, calendarReminderEnabled: true }),
    );
  });

  it('hides the urgent types while urgent letters are off and keeps their values', async () => {
    api.getEmail.mockResolvedValue({ ...verified, planOverdueEnabled: false });
    const wrapper = await mountPage();
    await wrapper.get('[name="urgentEnabled"]').setValue(false);
    expect(wrapper.find('[name="planOverdueEnabled"]').exists()).toBe(false);

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        urgentEnabled: false,
        planOverdueEnabled: false,
        calendarReminderEnabled: true,
      }),
    );
  });
```

- [ ] **Step 3: Падающие тесты страницы Telegram**

В `apps/web/app/pages/app/settings/telegram.test.ts`:

1. В объекте `unlinked` после строки `  amountsConsentAt: null,` добавить:

```ts
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
```

2. В тесте `saves settings and asks for a separate amounts consent` в объекте `toHaveBeenCalledWith` после строки `      amountsConsent: true,` добавить:

```ts
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
```

3. Перед тестом `unlinks after confirmation` добавить:

```ts
  it('offers the urgent types for Telegram and sends them with the save', async () => {
    api.getTelegram.mockResolvedValue({ ...linked, enabled: true });
    const wrapper = await mountPage();
    const group = wrapper.get('[role="group"][aria-label="Какие срочные сообщения присылать"]');
    expect(group.text()).toContain('Просроченные платежи');
    expect(group.text()).toContain('Напоминания календаря');

    await wrapper.get('[name="calendarReminderEnabled"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ planOverdueEnabled: true, calendarReminderEnabled: false }),
    );

    await wrapper.get('[name="urgentEnabled"]').setValue(false);
    expect(wrapper.find('[name="calendarReminderEnabled"]').exists()).toBe(false);
  });
```

На странице Telegram одна `<form>` (настройки уведомлений); переключатель команд бота — вне неё, поэтому `wrapper.get('form')` берёт нужную форму.

```bash
pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/notifications.test.ts app/pages/app/settings/telegram.test.ts
```

Ожидается: FAIL — блока типов ещё нет, в сохранении нет новых полей.

- [ ] **Step 4: Страница email**

В `apps/web/app/pages/app/settings/notifications.vue`, в `<script setup>`:

1. В `form` после строки `  includeAmounts: false,` добавить:

```ts
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
```

2. В `sync` после строки `  form.includeAmounts = next.includeAmounts;` добавить:

```ts
  form.planOverdueEnabled = next.planOverdueEnabled;
  form.calendarReminderEnabled = next.calendarReminderEnabled;
```

3. В `save`, в объекте `api.saveEmail({ ... })`, после строки `        includeAmounts: form.includeAmounts,` добавить:

```ts
        planOverdueEnabled: form.planOverdueEnabled,
        calendarReminderEnabled: form.calendarReminderEnabled,
```

В `<template>` сразу после абзаца

```vue
            <p class="email-settings__hint">
              Сразу сообщим о просроченном платеже и напомним о событии календаря.
            </p>
```

добавить:

```vue
            <div
              v-if="form.urgentEnabled"
              class="email-settings__types"
              role="group"
              aria-label="Какие срочные письма присылать"
            >
              <label class="email-settings__checkbox">
                <input
                  v-model="form.planOverdueEnabled"
                  name="planOverdueEnabled"
                  type="checkbox"
                />
                <span>Просроченные платежи</span>
              </label>
              <label class="email-settings__checkbox">
                <input
                  v-model="form.calendarReminderEnabled"
                  name="calendarReminderEnabled"
                  type="checkbox"
                />
                <span>Напоминания календаря</span>
              </label>
            </div>
```

В `<style>` после правила `.email-settings__hint { ... }` добавить:

```css
.email-settings__types {
  display: grid;
  gap: var(--hf-space-2);
  padding-left: var(--hf-space-8);
}
```

`--hf-space-8` — это отступ на ширину чекбокса и зазора у «Срочные письма»: так вложенные пункты видны как часть срочных.

- [ ] **Step 5: Страница Telegram**

В `apps/web/app/pages/app/settings/telegram.vue` — те же правки скрипта:

1. В `form` после `  includeAmounts: false,` добавить `planOverdueEnabled: true,` и `calendarReminderEnabled: true,`.
2. В `sync` после `  form.includeAmounts = next.includeAmounts;` добавить `form.planOverdueEnabled = next.planOverdueEnabled;` и `form.calendarReminderEnabled = next.calendarReminderEnabled;`.
3. В `save`, в объекте `api.saveTelegram({ ... })`, после `        includeAmounts: form.includeAmounts,` добавить:

```ts
        planOverdueEnabled: form.planOverdueEnabled,
        calendarReminderEnabled: form.calendarReminderEnabled,
```

В `<template>` сразу после абзаца

```vue
              <p class="telegram-settings__hint">
                Сразу сообщим о просроченном платеже и напомним о событии календаря.
              </p>
```

добавить:

```vue
              <div
                v-if="form.urgentEnabled"
                class="telegram-settings__types"
                role="group"
                aria-label="Какие срочные сообщения присылать"
              >
                <label class="telegram-settings__checkbox">
                  <input
                    v-model="form.planOverdueEnabled"
                    name="planOverdueEnabled"
                    type="checkbox"
                  />
                  <span>Просроченные платежи</span>
                </label>
                <label class="telegram-settings__checkbox">
                  <input
                    v-model="form.calendarReminderEnabled"
                    name="calendarReminderEnabled"
                    type="checkbox"
                  />
                  <span>Напоминания календаря</span>
                </label>
              </div>
```

В `<style>` после правила `.telegram-settings__hint { ... }` добавить:

```css
.telegram-settings__types {
  display: grid;
  gap: var(--hf-space-2);
  padding-left: var(--hf-space-8);
}
```

```bash
pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/notifications.test.ts app/pages/app/settings/telegram.test.ts
```

Ожидается: PASS.

- [ ] **Step 6: E2E-сценарий (только CI)**

В `e2e/family-calendar.spec.ts`:

1. После строки

```ts
  await form.getByRole('button', { name: 'Алия' }).click();
```

добавить:

```ts
  await form.getByRole('button', { name: 'За 1 день' }).click();
  await form.getByRole('button', { name: 'За 1 час' }).click();
```

2. После строки

```ts
  await expect(card).toContainText('Изменять событие может только автор');
```

добавить:

```ts
  await expect(card).toContainText('За 1 день, за 1 час');
```

Локально Playwright не запускать. Проверить только формат:

```bash
pnpm exec prettier --check e2e/family-calendar.spec.ts
```

- [ ] **Step 7: Документация**

Тексты вставлять дословно.

1. `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`:

   - Предложение `Правка одного повтора серии, недельная сетка с часами и несколько каналов напоминаний остаются вне v1.` заменить на:

     `Правка одного повтора серии и недельная сетка с часами остаются вне v1. Решением владельца от 03.11.2026 в объём перенесены несколько напоминаний на событие (до трёх) с доставкой по уже включённым каналам: [дизайн](2026-11-03-calendar-multiple-reminders-design.md).`

   - Фразу `одно необязательное напоминание внутри приложения;` заменить на:

     `до трёх необязательных напоминаний (в момент начала, за 5, 15 или 30 минут, за 1 или 2 часа, за 1 или 2 дня, за неделю);`

   - Фразу `Напоминание о событии доставляется один раз во внутренний центр уведомлений в заранее выбранный интервал до начала (от 15 минут до недели);` заменить на:

     `Каждое напоминание о событии доставляется один раз во внутренний центр уведомлений и во включённые каналы (email, Telegram, push) в выбранный интервал до начала (от момента начала до недели; у события на весь день — от 09:00 его дня);`

   - Строку `- несколько напоминаний на событие и внешняя доставка напоминаний;` заменить на:

     `- несколько напоминаний на событие и внешняя доставка напоминаний — реализованы, [дизайн](2026-11-03-calendar-multiple-reminders-design.md);`

   - В цитате, которая начинается со слов `> Решением владельца от 31.10.2026 в объём перенесена доставка по email`, перед предложением ` Ввод данных через Telegram остаётся вне v1.` вставить предложение:

     ` Решением владельца от 03.11.2026 у email и Telegram, как у push, появился выбор типов срочных уведомлений: [дизайн](2026-11-03-calendar-multiple-reminders-design.md).`

2. `docs/superpowers/specs/2026-10-30-family-calendar-design.md`: строку `- несколько напоминаний на событие, email/push/Telegram;` заменить на:

   `- несколько напоминаний на событие, email/push/Telegram — реализованы позже: [дизайн](2026-11-03-calendar-multiple-reminders-design.md);`

3. `docs/superpowers/specs/2026-11-03-calendar-multiple-reminders-design.md`: `Статус: согласован владельцем, не реализован.` заменить на `Статус: согласован владельцем, реализован.`

4. `README.md`:

   - строку `- семейный календарь общих событий и лента плановых платежей только для просмотра;` заменить на `- семейный календарь общих событий с напоминаниями (до трёх на событие) и лента плановых платежей только для просмотра;`;
   - строку `- в семейном календаре — правка или отмена отдельного повтора серии, недельная сетка с часами и несколько каналов напоминаний;` заменить на `- в семейном календаре — правка или отмена отдельного повтора серии и недельная сетка с часами;`.

Проверка, что всё заменилось:

```bash
grep -n "одно необязательное напоминание\|несколько каналов напоминаний\|от 15 минут до недели" docs/superpowers/specs/2026-08-30-family-budget-app-spec.md README.md || echo "clean"
```

Ожидается: `clean`.

- [ ] **Step 8: Проверки и stage**

```bash
pnpm --filter @harmofin/web test
pnpm typecheck
pnpm lint
pnpm exec prettier --check apps/web/app/pages/app/settings apps/web/app/composables/useNotificationSettings.ts e2e/family-calendar.spec.ts docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/superpowers/specs/2026-10-30-family-calendar-design.md docs/superpowers/specs/2026-11-03-calendar-multiple-reminders-design.md README.md
git add apps/web/app/composables/useNotificationSettings.ts apps/web/app/pages/app/settings/notifications.vue apps/web/app/pages/app/settings/telegram.vue apps/web/app/pages/app/settings/notifications.test.ts apps/web/app/pages/app/settings/telegram.test.ts e2e/family-calendar.spec.ts docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/superpowers/specs/2026-10-30-family-calendar-design.md docs/superpowers/specs/2026-11-03-calendar-multiple-reminders-design.md README.md
git status --short
```

**Review:** UI/UX (вложенная группа с `aria-label`, подписи как в push, клавиатура, сенсорные размеры чекбоксов по существующему стилю), QA (отправка обоих полей, скрытие при выключенных срочных, E2E-шаги), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(web): типы срочных уведомлений в настройках email и Telegram, документация"
```

После коммита — «Финальная проверка» из README.
