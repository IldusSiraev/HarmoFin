# Задача 7: переключатель «Команды бота» в вебе

Перед началом прочитать [README](README.md) и раздел «Интерфейс» спецификации. Перед любой визуальной правкой также прочитать [Calm Fintech](../../specs/2026-09-17-calm-fintech-visual-guidelines.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–6 закоммичены.

**Files:**
- Modify: `apps/web/app/composables/useNotificationSettings.ts` — поле `commandsEnabled` и метод `setTelegramCommands`.
- Modify: `apps/web/app/composables/useNotificationSettings.test.ts`
- Modify: `apps/web/app/pages/app/settings/telegram.vue` — раздел «Команды бота».
- Modify: `apps/web/app/pages/app/settings/telegram.test.ts`

**Interfaces:**
- Consumes (задача 3): `PUT /api/v1/me/notification-settings/telegram/commands`:
  - тело — `{ enabled, consent? }`;
  - ответ — настройки, теперь с полем `commandsEnabled: boolean`.
- Produces:
  - `useNotificationSettings().setTelegramCommands(input: { enabled: boolean; consent?: boolean }): Promise<TelegramNotificationSettings>`;
  - на странице: флажок `name="commandsConsent"`, кнопки `data-action="enable-commands"` и `data-action="disable-commands"`.

Правила интерфейса:
- Раздел показывается только при привязанном чате, под формой уведомлений и над кнопкой «Отключить Telegram».
- Состояние пишется текстом: «Команды включены.» или «Команды выключены.».
- Кнопка включения неактивна, пока флажок согласия не отмечен.
- Ошибка сервера показывается текстом через `UiStatus` с `tone="danger"`.
- Используются только существующие компоненты и токены.

---

- [ ] **Step 1: Тест composable (падающий)**

В `apps/web/app/composables/useNotificationSettings.test.ts` перед последней строкой `});` файла добавить:

```ts

  it('switches Telegram bot commands with an explicit consent', async () => {
    const api = useNotificationSettings();
    await api.setTelegramCommands({ enabled: true, consent: true });
    await api.setTelegramCommands({ enabled: false });
    expect(request.mock.calls).toEqual([
      [
        '/api/v1/me/notification-settings/telegram/commands',
        { method: 'PUT', body: JSON.stringify({ enabled: true, consent: true }) },
      ],
      [
        '/api/v1/me/notification-settings/telegram/commands',
        { method: 'PUT', body: JSON.stringify({ enabled: false }) },
      ],
    ]);
  });
```

Run: `cd apps/web && pnpm exec vitest run app/composables/useNotificationSettings.test.ts`
Expected: FAIL: `api.setTelegramCommands is not a function`.

- [ ] **Step 2: Composable**

В `apps/web/app/composables/useNotificationSettings.ts` четыре правки.

1. В `interface TelegramNotificationSettings` после `amountsConsentAt: string | null;` добавить:

```ts
  commandsEnabled: boolean;
```

2. После строки `export type TelegramNotificationSettingsInput = EmailNotificationSettingsInput;` добавить:

```ts

export interface TelegramCommandsInput {
  enabled: boolean;
  consent?: boolean;
}
```

3. После строки `const TELEGRAM_LINK = '/api/v1/me/telegram/link';` добавить:

```ts
const TELEGRAM_COMMANDS = '/api/v1/me/notification-settings/telegram/commands';
```

4. После метода `unlinkTelegram: () => api.request<void>(TELEGRAM_LINK, { method: 'DELETE' }),` добавить:

```ts
    setTelegramCommands: (input: TelegramCommandsInput) =>
      api.request<TelegramNotificationSettings>(TELEGRAM_COMMANDS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
```

Run: `cd apps/web && pnpm exec vitest run app/composables/useNotificationSettings.test.ts`
Expected: PASS.

- [ ] **Step 3: Тесты страницы (падающие)**

В `apps/web/app/pages/app/settings/telegram.test.ts` четыре правки.

1. В объект `api` внутри `vi.hoisted` добавить строку `setTelegramCommands: vi.fn(),`:

```ts
const api = vi.hoisted(() => ({
  getTelegram: vi.fn(),
  saveTelegram: vi.fn(),
  createTelegramLink: vi.fn(),
  unlinkTelegram: vi.fn(),
  setTelegramCommands: vi.fn(),
}));
```

2. В объекте `unlinked` после `amountsConsentAt: null,` добавить:

```ts
  commandsEnabled: false,
```

3. В `beforeEach` после строки `api.unlinkTelegram.mockReset().mockResolvedValue(undefined);` добавить:

```ts
    api.setTelegramCommands
      .mockReset()
      .mockImplementation(async (input: { enabled: boolean }) => ({
        ...linked,
        commandsEnabled: input.enabled,
      }));
```

4. Перед последней строкой `});` файла добавить:

```ts

  it('switches bot commands on only after the separate consent', async () => {
    api.getTelegram.mockResolvedValue({ ...linked });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('Команды выключены.');
    const enable = wrapper.get('[data-action="enable-commands"]');
    expect(enable.attributes('disabled')).toBeDefined();

    await wrapper.get('[name="commandsConsent"]').setValue(true);
    expect(wrapper.get('[data-action="enable-commands"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-action="enable-commands"]').trigger('click');
    await flushPromises();

    expect(api.setTelegramCommands).toHaveBeenCalledWith({ enabled: true, consent: true });
    expect(wrapper.text()).toContain('Команды включены.');
    expect(wrapper.find('[data-action="disable-commands"]').exists()).toBe(true);
    expect(wrapper.find('[name="commandsConsent"]').exists()).toBe(false);
  });

  it('switches bot commands off without asking again', async () => {
    api.getTelegram.mockResolvedValue({ ...linked, commandsEnabled: true });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('/expense');
    await wrapper.get('[data-action="disable-commands"]').trigger('click');
    await flushPromises();
    expect(api.setTelegramCommands).toHaveBeenCalledWith({ enabled: false });
    expect(wrapper.text()).toContain('Команды выключены.');
  });

  it('shows the server refusal next to the switch', async () => {
    api.getTelegram.mockResolvedValue({ ...linked });
    api.setTelegramCommands.mockRejectedValue(new Error('network'));
    const wrapper = await mountPage();
    await wrapper.get('[name="commandsConsent"]').setValue(true);
    await wrapper.get('[data-action="enable-commands"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="commands-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Команды выключены.');
  });

  it('hides the commands section without a linked chat', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-action="enable-commands"]').exists()).toBe(false);
  });
```

Run: `cd apps/web && pnpm exec vitest run app/pages/app/settings/telegram.test.ts`
Expected: FAIL: нет `[data-action="enable-commands"]`.

- [ ] **Step 4: Логика страницы**

В `apps/web/app/pages/app/settings/telegram.vue` внутри `<script setup>` после строки `let pollTimer: ReturnType<typeof setInterval> | null = null;` добавить:

```ts
const commandsConsent = ref(false);
const commandsSaving = ref(false);
const commandsError = ref('');

const COMMANDS_CONSENT =
  'Ответы бота с суммами, остатками и названиями остаются в истории чата Telegram. Из чата можно проводить операции от вашего имени. Я согласен включить команды бота';

const botCommands = [
  { command: '/expense', label: 'расход' },
  { command: '/income', label: 'доход' },
  { command: '/transfer', label: 'перевод между счетами' },
  { command: '/event', label: 'событие календаря' },
  { command: '/last', label: 'последние операции' },
  { command: '/plans', label: 'плановые платежи на 7 дней' },
  { command: '/events', label: 'события на 7 дней' },
  { command: '/balance', label: 'остатки и «Доступно»' },
  { command: '/cancel', label: 'отменить ввод' },
];

async function setCommands(enabled: boolean) {
  commandsSaving.value = true;
  commandsError.value = '';
  try {
    settings.value = await api.setTelegramCommands(
      enabled ? { enabled, consent: true } : { enabled },
    );
    commandsConsent.value = false;
  } catch (error) {
    commandsError.value = errorMessage(error).summary;
  } finally {
    commandsSaving.value = false;
  }
}
```

`settings.value` присваивается напрямую, без `sync()`: это не сбрасывает несохранённые поля формы уведомлений.

- [ ] **Step 5: Разметка страницы**

В шаблоне найти

```vue
          <div class="telegram-settings__unlink">
```

и перед ним вставить:

```vue
          <section class="telegram-settings__commands" aria-labelledby="telegram-commands-title">
            <h3 id="telegram-commands-title" class="telegram-settings__subtitle">Команды бота</h3>
            <p class="telegram-settings__text">
              Вносите расходы, доходы, переводы и события и смотрите остатки прямо в чате с ботом.
            </p>
            <UiStatus
              :label="settings.commandsEnabled ? 'Команды включены.' : 'Команды выключены.'"
              :tone="settings.commandsEnabled ? 'success' : 'info'"
              aria-live="polite"
            />
            <template v-if="!settings.commandsEnabled">
              <label class="telegram-settings__checkbox">
                <input v-model="commandsConsent" name="commandsConsent" type="checkbox" />
                <span>{{ COMMANDS_CONSENT }}</span>
              </label>
              <UiButton
                data-action="enable-commands"
                :disabled="!commandsConsent"
                :loading="commandsSaving"
                @click="setCommands(true)"
              >
                Включить команды
              </UiButton>
            </template>
            <UiButton
              v-else
              variant="secondary"
              data-action="disable-commands"
              :loading="commandsSaving"
              @click="setCommands(false)"
            >
              Выключить команды
            </UiButton>
            <UiStatus
              v-if="commandsError"
              data-test="commands-error"
              :label="commandsError"
              tone="danger"
              aria-live="polite"
            />
            <ul class="telegram-settings__command-list" aria-label="Команды бота">
              <li v-for="item in botCommands" :key="item.command">
                <code>{{ item.command }}</code> — {{ item.label }}
              </li>
            </ul>
          </section>

```

- [ ] **Step 6: Стили**

В `<style scoped>` после блока `.telegram-settings__unlink { ... }` добавить:

```css
.telegram-settings__commands {
  display: grid;
  gap: var(--hf-space-4);
  justify-items: start;
  max-width: 32rem;
  margin-top: var(--hf-space-6);
}

.telegram-settings__subtitle {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-small);
  font-weight: 600;
}

.telegram-settings__command-list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  list-style: none;
}
```

Это те же токены, что у `.push-settings__subtitle` на странице push. Новых цветов нет.

Если `UiStatus` не пробрасывает атрибут `data-test`, проверить в `apps/web/app/components/ui/Status.vue`, что у компонента один корневой элемент: тогда атрибут наследуется автоматически. Если корней несколько, обернуть `UiStatus` ошибки в `<div data-test="commands-error">`.

Run: `cd apps/web && pnpm exec vitest run app/pages/app/settings/telegram.test.ts`
Expected: PASS, все тесты страницы, включая прежние.

- [ ] **Step 7: Проверки**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --check apps/web/app/pages/app/settings/telegram.vue apps/web/app/pages/app/settings/telegram.test.ts apps/web/app/composables/useNotificationSettings.ts apps/web/app/composables/useNotificationSettings.test.ts`
Expected: PASS. Если упало, выполнить `--write`.

Локальный Playwright не запускать. Сценарий для CI добавляется в задаче 8.

- [ ] **Step 8: Review по чек-листу**

Выполнить `git add apps/web/app/composables/useNotificationSettings.ts apps/web/app/composables/useNotificationSettings.test.ts apps/web/app/pages/app/settings/telegram.vue apps/web/app/pages/app/settings/telegram.test.ts`, затем просмотреть `git diff --staged`.

- **UI/UX:**
  - только существующие компоненты (`UiStatus`, `UiButton`) и токены;
  - состояние написано текстом;
  - согласие — подписанный флажок с видимым текстом;
  - кнопка неактивна без согласия;
  - кнопки и флажок доступны с клавиатуры;
  - ошибка объявляется через `aria-live`.
- **security:**
  - `consent: true` уходит только после отметки флажка;
  - токены и данные чата в вебе не хранятся;
  - `localStorage` не используется.
- **QA:** покрыты включение с согласием, выключение, ошибка сервера, скрытие без привязки и тело запроса composable.
- **final:**
  - прежние тесты страницы не изменились, кроме поля `commandsEnabled` в фикстуре;
  - лишних файлов нет.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git commit -m "feat(web): переключатель команд Telegram-бота с согласием"
```

Добавить строку в «Ход выполнения».
