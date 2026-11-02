# Задача 8: инфраструктура, E2E и документы

Перед началом: прочитать [README](README.md). Задачи 1–7 закоммичены.

**Files:**
- Modify: `.env.example`, `infra/env/staging.example`, `infra/compose/production.yml` — переменные VAPID.
- Modify: `docs/runbooks/production-server-bootstrap.md`, `docs/runbooks/secret-rotation.md` — ключи VAPID.
- Modify: `e2e/playwright.config.ts` — `VAPID_PUBLIC_KEY` для API в E2E.
- Create: `e2e/web-push.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` — 4.2, 15.1, 18.6.
- Modify: `CLAUDE.md`, `README.md` — push больше не в исключениях v1.

**Interfaces:**
- Consumes (задача 2): API читает `VAPID_PUBLIC_KEY` (base64url, 87 символов, первый байт `0x04`).
- Consumes (задача 5): воркер читает `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — все три или ни одной.
- Consumes (задача 7): страница `/app/settings/push`, ссылка «Push-уведомления», тексты кнопок и полей (см. задачу 7, блок Produces).
- Produces: ничего для других задач.

---

- [ ] **Step 1: Проверить команду генерации ключей**

```bash
pnpm --filter @harmofin/worker exec web-push generate-vapid-keys --json
```

Expected: JSON вида `{"publicKey":"B...","privateKey":"..."}`: `publicKey` из 87 символов, `privateKey` из 43. Значения никуда не записывать и не коммитить. Если команда не работает, остановиться и записать это в «Ход выполнения»: ниже она упоминается в документах.

- [ ] **Step 2: `.env.example`**

После строки `TELEGRAM_WEBHOOK_SECRET=` добавить:

```bash
# Push-уведомления (необязательно). Ключи: pnpm --filter @harmofin/worker exec web-push generate-vapid-keys --json
# Публичный ключ нужен API и воркеру, приватный ключ и VAPID_SUBJECT — только воркеру. Пустые значения выключают push.
# Локально push проверяется только на собранном приложении: service worker в pnpm dev не регистрируется.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

- [ ] **Step 3: `infra/env/staging.example`**

После строки `TELEGRAM_WEBHOOK_SECRET=<optional-provided-at-runtime>` добавить:

```bash
# Web push: a separate VAPID key pair per environment. Optional; empty disables push.
# Generate: pnpm --filter @harmofin/worker exec web-push generate-vapid-keys --json
# VAPID_SUBJECT: mailto:<operator email> or https://<environment-domain>.
VAPID_PUBLIC_KEY=<optional-provided-at-runtime>
VAPID_PRIVATE_KEY=<optional-provided-at-runtime>
VAPID_SUBJECT=<optional-mailto-or-https>
```

Файл может храниться с CRLF: перевод строк сохранить как в файле.

- [ ] **Step 4: `infra/compose/production.yml`**

В сервисе `api` после строки `      TELEGRAM_WEBHOOK_SECRET: ${TELEGRAM_WEBHOOK_SECRET:-}` добавить:

```yaml
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
```

В сервисе `worker` после строки `      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}` (вторая по счёту строка с `TELEGRAM_BOT_TOKEN` в файле, рядом с `expose: - '3002'`) добавить:

```yaml
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-}
```

Приватный ключ в сервис `api` и `web` **не добавлять**.

Run: `IMAGE_TAG=test DATABASE_URL=postgresql://u:p@postgres:5432/d docker compose --env-file infra/env/staging.example -f infra/compose/production.yml config --quiet`
Expected: без ошибок. Если Docker недоступен, записать в «Ход выполнения», что проверка не выполнена.

- [ ] **Step 5: Runbook**

В `docs/runbooks/production-server-bootstrap.md` после пункта `- **Telegram-бот (необязательно)**: ...` добавить пункт:

```markdown
- **Push-уведомления (необязательно)**: один раз на окружение создать пару VAPID-ключей командой `pnpm --filter @harmofin/worker exec web-push generate-vapid-keys --json` (для staging — отдельную пару). В `.env.production` задать `VAPID_PUBLIC_KEY` (`publicKey`), `VAPID_PRIVATE_KEY` (`privateKey`) и `VAPID_SUBJECT` (`mailto:<почта оператора>` или `https://<домен>`). Публичный ключ получают API и воркер, приватный — только воркер. Смена пары отключает все устройства: пользователи включают push заново. Без этих переменных push в приложении выключен.
```

В `docs/runbooks/secret-rotation.md` в таблицу «Инвентарь секретов» после строки `TELEGRAM_WEBHOOK_SECRET` добавить строку (выравнивание колонок поправит `prettier`):

```markdown
| `VAPID_PRIVATE_KEY` (с `VAPID_PUBLIC_KEY`) | API (публичный), worker | Среднее — все устройства отключаются, push включают заново | Нет — рестарт API и worker с новой парой |
```

Run: `pnpm exec prettier --write docs/runbooks/production-server-bootstrap.md docs/runbooks/secret-rotation.md`

- [ ] **Step 6: Конфиг E2E**

В `e2e/playwright.config.ts` в объекте `testEnvironment` после строки `  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9',` добавить:

```ts
  // Public VAPID key only (0x04 + 64 bytes): E2E never sends a real push, the worker is not started.
  VAPID_PUBLIC_KEY:
    'BAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
```

- [ ] **Step 7: E2E-сценарий**

Файл `e2e/web-push.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';
// Device keys in the browser's format (0x04 + 64 bytes; 16 bytes). Not a real device.
const deviceKeys = {
  p256dh: 'BAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  auth: 'AgICAgICAgICAgICAgICAg',
};

async function register(page: Page): Promise<void> {
  const email = `e2e-push-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/**
 * The dev server registers no service worker and CI has no push service: Notification,
 * the registration and its PushManager are replaced before any page script runs.
 */
async function fakePush(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => permission });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        permission = 'granted';
        return permission;
      },
    });
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
    const subscription = {
      endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint, expirationTime: null, keys }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    let current: typeof subscription | null = null;
    const registration = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => {
          current = subscription;
          return subscription;
        },
      },
    };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
      configurable: true,
      value: async () => registration,
    });
  }, deviceKeys);
}

test('enables push on this device, picks the types and disconnects it', async ({ page }) => {
  test.setTimeout(90_000);
  await fakePush(page);
  await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Push-уведомления' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/push$/);

  await page.getByRole('button', { name: 'Включить на этом устройстве' }).click();
  await expect(page.getByText('Уведомления включены на этом устройстве.')).toBeVisible();
  await expect(page.getByText('Это устройство')).toBeVisible();
  await expect(page.getByLabel('Присылать push-уведомления')).toBeChecked();

  await page.getByLabel('Напоминания календаря').uncheck();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Просроченные платежи')).toBeChecked();
  await expect(page.getByLabel('Напоминания календаря')).not.toBeChecked();

  await page.getByRole('button', { name: /^Отключить / }).click();
  await expect(page.getByRole('button', { name: 'Включить на этом устройстве' })).toBeVisible();
});
```

Run (из `apps/api`, в корне нет бинаря `tsc`): `cd apps/api && pnpm exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --types node ../../e2e/web-push.spec.ts`
Expected: без ошибок типов. У `e2e/` нет своего tsconfig: если команда падает из-за окружения, а не из-за кода спеки, записать в «Ход выполнения», CI проверит. **Playwright локально не запускать**: сценарий выполняется в CI.

- [ ] **Step 8: Функциональная спецификация**

В `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`:

1. В разделе 4.2 удалить строку

```markdown
- push-уведомления (email-уведомления перенесены в объём 31.10.2026, см. 15.1);
```

2. В разделе 15.1 в цитате `> Решением владельца от 31.10.2026 ...` заменить последнее предложение `Ввод данных через Telegram и push остаются вне v1.` на:

```markdown
Решением владельца от 02.11.2026 в объём перенесены push-уведомления в браузере: срочные уведомления (просроченный платёж, напоминание календаря) на устройства пользователя, без сумм, с выбором типов, устройство привязано к сессии: [дизайн](2026-11-02-web-push-notifications-design.md). Ввод данных через Telegram остаётся вне v1.
```

3. В разделе 18.6 строку

```markdown
- push-уведомления в браузере (service worker, VAPID-ключи, хранение подписок);
```

заменить на

```markdown
- push-уведомления в браузере (service worker, VAPID-ключи, хранение подписок) — реализованы: срочные уведомления на устройства, [дизайн](2026-11-02-web-push-notifications-design.md);
```

4. В разделе 18.6 в абзаце `Порядок внешней доставки согласован владельцем 31.10.2026: ...` заменить концовку `ввод через Telegram и push требуют отдельного решения.` на:

```markdown
push-уведомления перенесены в объём решением владельца от 02.11.2026 ([дизайн](2026-11-02-web-push-notifications-design.md)); ввод через Telegram требует отдельного решения.
```

- [ ] **Step 9: `CLAUDE.md` и `README.md`**

В `CLAUDE.md`:

1. В абзаце «Current scope and architecture» заменить фрагмент `Telegram notifications (private chat linked by a one-time link),` на `Telegram notifications (private chat linked by a one-time link), web push notifications (per-device browser subscriptions bound to the session),`.
2. Заменить фрагмент `web push and other external notification delivery (email notifications are implemented: see the [email notifications design](docs/superpowers/specs/2026-10-31-email-notifications-design.md)),` на:

```markdown
external notification delivery beyond email, Telegram and web push (email notifications are implemented: see the [email notifications design](docs/superpowers/specs/2026-10-31-email-notifications-design.md); web push notifications are implemented: see the [web push notifications design](docs/superpowers/specs/2026-11-02-web-push-notifications-design.md)),
```

В `README.md` в разделе «Ограничения v1» заменить строку

```markdown
- push-уведомления в браузере; срочные уведомления и дайджест семьи приходят во внутренний центр, а по выбору пользователя — на почту и в Telegram (включаются в настройках);
```

на

```markdown
- дайджест семьи в push-уведомлениях: срочные уведомления приходят во внутренний центр, а по выбору пользователя — на почту, в Telegram и push-уведомлениями на устройства; дайджест — только на почту и в Telegram (всё включается в настройках);
```

Run: `pnpm exec prettier --write CLAUDE.md README.md docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`
Expected: prettier меняет только перенос строк, если вообще что-то меняет.

- [ ] **Step 10: Финальная проверка**

Выполнить блок «Финальная проверка» из [README](README.md). Ожидания — там же.

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 11: Review по чек-листу**

```bash
git add .env.example infra/env/staging.example infra/compose/production.yml docs/runbooks/production-server-bootstrap.md docs/runbooks/secret-rotation.md e2e/playwright.config.ts e2e/web-push.spec.ts docs/superpowers/specs/2026-08-30-family-budget-app-spec.md CLAUDE.md README.md
git diff --staged
```

Чек-лист:

- release:
  - production compose передаёт API только публичный ключ, воркеру — три переменные;
  - все значения необязательные (`:-`), деплой без них не падает;
  - в примерах только плейсхолдеры;
  - runbook описывает генерацию, отдельную пару для staging и последствия смены ключа.
- security:
  - ни одного настоящего ключа в diff, тестовый публичный ключ — синтетический;
  - приватный ключ не попадает в `api` и `web`;
  - E2E не обращается к внешним сервисам.
- QA: E2E покрывает включение, типы, перезагрузку и отключение; Playwright локально не запускался (только CI).
- final:
  - функциональная спецификация, `CLAUDE.md` и `README.md` больше не называют push исключённым;
  - формулировки на русском (кроме `CLAUDE.md`, он на английском);
  - `identity/logo_description.png` не тронут.

- [ ] **Step 12: Commit**

```bash
git branch --show-current
git commit -m "feat(push): env, compose, E2E и документы для push-уведомлений"
```

Добавить строку в «Ход выполнения» README и закоммитить (`docs(push): ход выполнения`). Затем остановиться и сообщить владельцу итог по блоку «Финальная проверка» README. Push и PR — только с разрешения владельца.
