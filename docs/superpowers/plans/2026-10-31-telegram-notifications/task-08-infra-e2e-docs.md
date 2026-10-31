# Задача 8: инфраструктура, E2E и документация

Перед началом: прочитать [README](README.md). Задачи 1–7 закоммичены.

**Files:**
- Modify: `.env.example`, `infra/env/staging.example`, `infra/compose/production.yml` — переменные `TELEGRAM_*`.
- Create: `infra/scripts/telegram-webhook.sh`, `infra/scripts/telegram-webhook.test.sh`
- Modify: `infra/scripts/deploy.sh` — регистрация webhook после smoke.
- Modify: `docs/runbooks/production-server-bootstrap.md`, `docs/runbooks/secret-rotation.md`
- Modify: `e2e/playwright.config.ts` — env Telegram для API.
- Create: `e2e/telegram-notifications.spec.ts`
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`, `docs/superpowers/specs/2026-10-31-telegram-notifications-design.md` — статус.

**Interfaces:**
- Consumes: переменные API `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (32–256 символов `A-Za-z0-9_-`), `TELEGRAM_API_BASE_URL` (задача 2); воркера `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL` (задача 6); webhook `POST /api/v1/telegram/webhook` с заголовком `X-Telegram-Bot-Api-Secret-Token` (задача 3); тексты страницы `/app/settings/telegram` (задача 7).
- Produces: `register_telegram_webhook` в `infra/scripts/telegram-webhook.sh`.

---

- [ ] **Step 1: Переменные окружения**

`.env.example` — после строки `WEB_BASE_URL=http://localhost:3000` добавить:

```dotenv
# Telegram-бот (необязательно). Без токена канал Telegram выключен. Локально webhook не регистрируется.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
```

`infra/env/staging.example` — после строки `WEB_BASE_URL=https://<environment-domain>` добавить:

```dotenv
# Telegram bot: one bot per environment (separate bot for staging). Optional; empty disables Telegram.
# TELEGRAM_WEBHOOK_SECRET: 32-256 characters of A-Z, a-z, 0-9, _ and - (openssl rand -hex 32).
TELEGRAM_BOT_TOKEN=<optional-provided-at-runtime>
TELEGRAM_BOT_USERNAME=<optional-bot-username>
TELEGRAM_WEBHOOK_SECRET=<optional-provided-at-runtime>
```

`infra/compose/production.yml`:
- в окружении сервиса `api` после строки `WEB_BASE_URL: ${WEB_BASE_URL:?WEB_BASE_URL is required}` (первое вхождение, около строки 113) добавить:

```yaml
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      TELEGRAM_BOT_USERNAME: ${TELEGRAM_BOT_USERNAME:-}
      TELEGRAM_WEBHOOK_SECRET: ${TELEGRAM_WEBHOOK_SECRET:-}
```

- в окружении сервиса `worker` после строки `WEB_BASE_URL: ${WEB_BASE_URL:?WEB_BASE_URL is required}` (второе вхождение, около строки 168) добавить:

```yaml
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
```

Run: `IMAGE_TAG=test DATABASE_URL=postgresql://u:p@postgres:5432/d docker compose --env-file infra/env/staging.example -f infra/compose/production.yml config --quiet`
Expected: без ошибок. Если Docker недоступен — пропустить и записать в «Ход выполнения»; CI проверит `production-topology.test.mjs`.

- [ ] **Step 2: Тест скрипта webhook (падает)**

Файл `infra/scripts/telegram-webhook.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/telegram-webhook.sh"

calls_file="$(mktemp)"
trap 'rm -f "$calls_file"' EXIT

# Captures the request instead of calling Telegram.
telegram_post() {
  printf '%s\n%s\n' "$1" "$2" >"$calls_file"
  local ok_response='{"ok":true,"result":true}'
  printf '%s' "${FAKE_TELEGRAM_RESPONSE:-$ok_response}"
}

unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET WEB_BASE_URL TELEGRAM_API_BASE_URL
output="$(register_telegram_webhook 2>&1)"
status=$?
assert_equal "skips without a bot token" "0" "$status"
assert_equal "says why it skipped" "Telegram bot is not configured; skipping webhook registration." "$output"

export TELEGRAM_BOT_TOKEN="123456:script-secret-token"
export TELEGRAM_WEBHOOK_SECRET="webhook-secret-with-at-least-32-chars_"
export WEB_BASE_URL="http://harmofin.example"
assert_failure "requires an https web address" register_telegram_webhook

export WEB_BASE_URL="https://harmofin.example/"
output="$(register_telegram_webhook 2>&1)"
status=$?
assert_equal "registers with an https web address" "0" "$status"
url_line="$(sed -n 1p "$calls_file")"
body_line="$(sed -n 2p "$calls_file")"
assert_equal "calls setWebhook on the default API" \
  "https://api.telegram.org/bot123456:script-secret-token/setWebhook" "$url_line"
assert_equal "sends url, secret, allowed updates and drops pending updates" \
  '{"url":"https://harmofin.example/api/v1/telegram/webhook","secret_token":"webhook-secret-with-at-least-32-chars_","allowed_updates":["message","my_chat_member"],"drop_pending_updates":true}' \
  "$body_line"
if [[ "$output" == *"script-secret-token"* || "$output" == *"webhook-secret-with"* ]]; then
  echo "not ok - never prints the bot token or the secret"
  failures=$((failures + 1))
else
  echo "ok - never prints the bot token or the secret"
fi

FAKE_TELEGRAM_RESPONSE='{"ok":false,"error_code":401,"description":"Unauthorized"}'
assert_failure "fails when Telegram rejects the call" register_telegram_webhook
unset FAKE_TELEGRAM_RESPONSE

export TELEGRAM_WEBHOOK_SECRET="short"
assert_failure "rejects an unsafe secret" register_telegram_webhook

report_results
```

Run: `bash infra/scripts/telegram-webhook.test.sh`
Expected: FAIL (скрипта нет).

- [ ] **Step 3: Скрипт webhook**

Файл `infra/scripts/telegram-webhook.sh`:

```bash
#!/usr/bin/env bash
# Registers the Telegram bot webhook at ${WEB_BASE_URL}/api/v1/telegram/webhook.
# Idempotent: setWebhook replaces the previous registration. Skips when no bot
# token is configured. Never prints the bot token or the webhook secret: the
# token is part of the Bot API URL, so curl errors are not shown either.
set -uo pipefail

# telegram_post <url> <json-body>
# Prints the response body. Overridable in tests.
telegram_post() {
  curl --silent --max-time 15 --header 'Content-Type: application/json' --data "$2" "$1" 2>/dev/null
}

register_telegram_webhook() {
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    echo "Telegram bot is not configured; skipping webhook registration."
    return 0
  fi
  if [[ ! "${TELEGRAM_WEBHOOK_SECRET:-}" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; then
    echo "TELEGRAM_WEBHOOK_SECRET must be 32-256 characters of A-Z, a-z, 0-9, _ and -." >&2
    return 1
  fi
  local web_base_url="${WEB_BASE_URL:-}"
  web_base_url="${web_base_url%/}"
  if [[ "$web_base_url" != https://* ]]; then
    echo "WEB_BASE_URL must be an https address to register the Telegram webhook." >&2
    return 1
  fi

  local api_base_url="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"
  api_base_url="${api_base_url%/}"
  local webhook_url="${web_base_url}/api/v1/telegram/webhook"
  local payload
  payload="$(printf '{"url":"%s","secret_token":"%s","allowed_updates":["message","my_chat_member"],"drop_pending_updates":true}' \
    "$webhook_url" "$TELEGRAM_WEBHOOK_SECRET")"

  local response
  if ! response="$(telegram_post "${api_base_url}/bot${TELEGRAM_BOT_TOKEN}/setWebhook" "$payload")"; then
    echo "Telegram webhook registration failed: Bot API is unreachable." >&2
    return 1
  fi
  if [[ "$response" != *'"ok":true'* ]]; then
    echo "Telegram webhook registration was rejected by the Bot API." >&2
    return 1
  fi
  echo "Telegram webhook registered at ${webhook_url}."
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  register_telegram_webhook
fi
```

Run: `bash infra/scripts/telegram-webhook.test.sh`
Expected: все строки `ok -`, код выхода 0.

Если окружение Windows сохраняет файл с CRLF — `bash` упадёт на `$'\r'`. Проверить `git diff --stat` и при необходимости сохранить с LF (как остальные `infra/scripts/*.sh`).

- [ ] **Step 4: Вызов из деплоя**

В `infra/scripts/deploy.sh`:

1. После строки `source "$deploy_script_dir/smoke.sh"` добавить:

```bash
# shellcheck source=telegram-webhook.sh
source "$deploy_script_dir/telegram-webhook.sh"
```

2. После функции `run_deploy_smoke() { ... }` добавить:

```bash
# run_telegram_webhook
# Registers the Telegram webhook when a bot token is configured. Overridable
# in tests.
run_telegram_webhook() {
  register_telegram_webhook
}
```

3. В `run_deploy` между блоком smoke

```bash
  echo "Running post-deploy smoke checks..."
  if ! run_deploy_smoke; then
    echo "Smoke checks failed after deployment." >&2
    return 1
  fi
```

и строкой `echo "Removing old release images ...` вставить:

```bash
  # A failed registration must not fail a healthy release: the previous webhook
  # registration keeps working, and the next deploy retries.
  if ! run_telegram_webhook; then
    echo "Warning: Telegram webhook registration failed; deployment continues." >&2
  fi
```

В `infra/scripts/deploy.test.sh` перед последней строкой `report_results` добавить:

```bash
# run_deploy keeps a healthy release when the Telegram webhook registration fails.
webhook_status="$(
  WEB_IMAGE=registry.invalid/web API_IMAGE=registry.invalid/api WORKER_IMAGE=registry.invalid/worker \
    MIGRATE_IMAGE=registry.invalid/migrate DATABASE_URL=postgresql://u:p@db.invalid/h IMAGE_TAG=abc1234 \
    bash -c 'source infra/scripts/deploy.sh
      current_release_tag() { :; }
      run_migration() { return 0; }
      reconcile_services() { return 0; }
      wait_for_services_healthy() { return 0; }
      run_deploy_smoke() { return 0; }
      remove_old_release_images() { return 0; }
      run_telegram_webhook() { return 1; }
      run_deploy >/dev/null 2>&1; echo $?'
)"
assert_equal "run_deploy succeeds when the Telegram webhook registration fails" "0" "$webhook_status"
```

Заглушки совпадают с функциями, которые сейчас вызывает `run_deploy` (`require_env_vars`, `validate_image_tag`, `current_release_tag`, `run_migration`, `reconcile_services`, `wait_for_services_healthy`, `run_deploy_smoke`, `remove_old_release_images`).

Run: `for test_file in infra/scripts/*.test.sh; do bash "$test_file" || exit 1; done`
Expected: все `ok -`, код 0.

- [ ] **Step 5: Runbook**

В `docs/runbooks/production-server-bootstrap.md` в разделе `## 6. \`.env.production\`` после пункта про секреты (`- Секреты (\`AUTH_TOKEN_HASH_SECRET\`, ...`) добавить:

```markdown
- **Telegram-бот (необязательно)**: создать бота у [@BotFather](https://t.me/BotFather) (`/newbot`), для staging — отдельного бота. В `.env.production` задать `TELEGRAM_BOT_TOKEN` (токен от BotFather), `TELEGRAM_BOT_USERNAME` (имя бота без `@`) и `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`). `deploy.sh` после smoke сам регистрирует webhook `https://<домен>/api/v1/telegram/webhook` скриптом [telegram-webhook.sh](../../infra/scripts/telegram-webhook.sh); ошибка регистрации выводится предупреждением и не откатывает релиз. Проверить: `curl -s https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — в ответе `url` с доменом и пустой `last_error_message`. Без этих переменных канал Telegram в приложении выключен.
```

В `docs/runbooks/secret-rotation.md` в таблицу «Инвентарь секретов» после строки `SMTP credentials` добавить строки (выравнивание поправит prettier):

```markdown
| `TELEGRAM_BOT_TOKEN`                      | API, worker, деплой  | Среднее — только Telegram       | Нет — рестарт API и worker, затем повторный деплой (webhook) |
| `TELEGRAM_WEBHOOK_SECRET`                 | API, деплой          | Низкое — только webhook         | Нет — рестарт API и повторная регистрация webhook  |
```

Run: `pnpm exec prettier --write docs/runbooks/production-server-bootstrap.md docs/runbooks/secret-rotation.md`

- [ ] **Step 6: E2E (только CI)**

В `e2e/playwright.config.ts` в объект `testEnvironment` после `MAIL_FROM: 'no-reply@harmofin.test',` добавить:

```ts
  TELEGRAM_BOT_TOKEN: '123456:e2e-only-token',
  TELEGRAM_BOT_USERNAME: 'harmofin_e2e_bot',
  TELEGRAM_WEBHOOK_SECRET: 'e2e-only-webhook-secret-with-32-chars',
  // Closed port: the bot's replies fail fast and never leave the CI runner.
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9',
```

Файл `e2e/telegram-notifications.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

import { apiV1 } from './env';

const password = 'e2e-password-10';
const webhookSecret = 'e2e-only-webhook-secret-with-32-chars';

async function register(page: Page): Promise<void> {
  const email = `e2e-telegram-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test('links Telegram through the bot webhook, enables the channel and unlinks', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Уведомления в Telegram' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/telegram$/);

  const connect = page.getByRole('button', { name: 'Подключить Telegram' });
  await expect(connect).toBeDisabled();
  await page.getByLabel('Согласен на отправку уведомлений через Telegram').check();
  await connect.click();

  const open = page.getByRole('link', { name: /Открыть Telegram/ });
  await expect(open).toBeVisible();
  const code = new URL((await open.getAttribute('href'))!).searchParams.get('start');
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Telegram calls the webhook without Origin: the request fixture sends none either.
  const update = await request.post(`${apiV1}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    data: {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: Date.now(), type: 'private' },
        text: `/start ${code}`,
      },
    },
  });
  expect(update.status()).toBe(200);

  // The page polls every 3 seconds.
  await expect(page.getByText('Telegram подключён.')).toBeVisible();
  await page.getByLabel('Присылать уведомления в Telegram').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Присылать уведомления в Telegram')).toBeChecked();

  await page.getByRole('button', { name: 'Отключить Telegram' }).click();
  await page
    .getByRole('dialog', { name: 'Отключить Telegram?' })
    .getByRole('button', { name: 'Отключить', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Подключить Telegram' })).toBeVisible();
});

test('rejects a webhook call without the secret', async ({ request }) => {
  const response = await request.post(`${apiV1}/telegram/webhook`, { data: { update_id: 2 } });
  expect(response.status()).toBe(401);
});
```

Локально **не запускать**. Проверить только типы и формат:

Run: `pnpm exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --types node e2e/telegram-notifications.spec.ts`
Expected: без ошибок типов (у `e2e/` нет своего tsconfig; если команда падает на окружении, а не на коде спеки, — записать в «Ход выполнения», CI проверит).
Run: `pnpm exec prettier --check e2e/telegram-notifications.spec.ts e2e/playwright.config.ts`
Expected: без ошибок.

- [ ] **Step 7: Документация и статус**

`README.md`, раздел «Ограничения v1»:
- строку `- Telegram-бот;` заменить на `- ввод операций и событий календаря через Telegram-бота (уведомления в Telegram реализованы);`;
- строку `- email- и push-уведомления — уведомления, в том числе напоминания календаря, приходят только во внутренний центр уведомлений; по email отправляются лишь письма восстановления пароля и приглашения в семью;` заменить на `- push-уведомления в браузере; срочные уведомления и дайджест семьи приходят во внутренний центр, а по выбору пользователя — на почту и в Telegram (включаются в настройках);`.

`CLAUDE.md`, абзац «Current scope and architecture»:
- фрагмент `email notifications with on-demand address confirmation,` заменить на `email notifications with on-demand address confirmation, Telegram notifications (private chat linked by a one-time link),`;
- фрагмент `bank statement import and bank integrations, Telegram, web push and other external notification delivery (email notifications are implemented: see the [email notifications design](docs/superpowers/specs/2026-10-31-email-notifications-design.md)),` заменить на `bank statement import and bank integrations, Telegram data entry (Telegram notifications are implemented: see the [Telegram notifications design](docs/superpowers/specs/2026-10-31-telegram-notifications-design.md)), web push and other external notification delivery (email notifications are implemented: see the [email notifications design](docs/superpowers/specs/2026-10-31-email-notifications-design.md)),`.

`docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`, раздел 18.3: в цитате `— в работе,` заменить на `— реализовано,`.

`docs/superpowers/specs/2026-10-31-telegram-notifications-design.md`: строку статуса `Статус: согласован владельцем.` заменить на `Статус: согласован владельцем, реализован.`

Run: `pnpm exec prettier --check README.md CLAUDE.md docs`
Expected: PASS (иначе `--write` по этим файлам).

- [ ] **Step 8: Финальная проверка ветки**

Выполнить блок «Финальная проверка» из [README](README.md).

- [ ] **Step 9: Review по чек-листу**

`git add .env.example infra e2e README.md CLAUDE.md docs` и `git diff --staged`:

- release: переменные необязательные (`:-`), деплой без Telegram ведёт себя как раньше; ошибка регистрации webhook не валит релиз (тест есть); скрипт идемпотентный.
- security: токен и секрет не печатаются (тест есть); вывод `curl` подавлен; в env-шаблонах только плейсхолдеры; E2E-токен ненастоящий, ответы бота идут на закрытый порт.
- QA: bash-тесты зелёные; E2E проверяет согласие, ссылку, webhook без Origin, опрос, сохранение, отвязку и 401; локально не запускался (только CI) — отметить в «Ход выполнения».
- final: README и CLAUDE.md не называют ввод через Telegram реализованным; `identity/logo_description.png` не тронут.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): регистрация webhook при деплое, E2E и документация"
```

Добавить последнюю строку в «Ход выполнения» README (её можно закоммитить отдельно: `docs(telegram): ход выполнения`). Затем остановиться и сообщить владельцу итоги (см. README, «Финальная проверка»). Не пушить без разрешения.
