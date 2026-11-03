# Задача 8: скрипт webhook, E2E и документация

Перед началом прочитать [README](README.md). Ветка — `feat/telegram-bot-commands`. Задачи 1–7 закоммичены.

**Files:**
- Modify: `infra/scripts/telegram-webhook.sh` — `callback_query` в `allowed_updates` и меню команд `setMyCommands`.
- Modify (полная замена): `infra/scripts/telegram-webhook.test.sh`
- Modify: `e2e/telegram-notifications.spec.ts` — включение команд и вызов `/balance`.
- Modify: `docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md` — статус.
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` — разделы 18.3 и 18.6.
- Modify: `docs/runbooks/production-server-bootstrap.md` — пункт о Telegram-боте.
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes:
  - задача 3 — `PUT .../telegram/commands`;
  - задача 5 — ответы бота и команды;
  - задача 7 — подписи на странице: флажок с текстом «…Я согласен включить команды бота», кнопка «Включить команды», статус «Команды включены.».
- Produces: регистрация webhook подписывается на `message`, `callback_query`, `my_chat_member` и обновляет меню команд. Если меню обновить не удалось, выводится предупреждение, а результат остаётся успешным, потому что webhook уже зарегистрирован.

---

- [ ] **Step 1: Тест скрипта (падающий)**

Полностью заменить `infra/scripts/telegram-webhook.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/telegram-webhook.sh"

calls_file="$(mktemp)"
trap 'rm -f "$calls_file"' EXIT

# Captures every request (URL line, body line) instead of calling Telegram.
telegram_post() {
  printf '%s\n%s\n' "$1" "$2" >>"$calls_file"
  local ok_response='{"ok":true,"result":true}'
  if [[ "$1" == */setMyCommands ]]; then
    printf '%s' "${FAKE_COMMANDS_RESPONSE:-$ok_response}"
  else
    printf '%s' "${FAKE_TELEGRAM_RESPONSE:-$ok_response}"
  fi
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
: >"$calls_file"
output="$(register_telegram_webhook 2>&1)"
status=$?
assert_equal "registers with an https web address" "0" "$status"
assert_equal "calls setWebhook on the default API" \
  "https://api.telegram.org/bot123456:script-secret-token/setWebhook" "$(sed -n 1p "$calls_file")"
assert_equal "sends url, secret, allowed updates with buttons and drops pending updates" \
  '{"url":"https://harmofin.example/api/v1/telegram/webhook","secret_token":"webhook-secret-with-at-least-32-chars_","allowed_updates":["message","callback_query","my_chat_member"],"drop_pending_updates":true}' \
  "$(sed -n 2p "$calls_file")"
assert_equal "then updates the commands menu" \
  "https://api.telegram.org/bot123456:script-secret-token/setMyCommands" "$(sed -n 3p "$calls_file")"
commands_body="$(sed -n 4p "$calls_file")"
if [[ "$commands_body" == *'"command":"expense"'* && "$commands_body" == *'"command":"balance"'* && "$commands_body" == *'"command":"stop"'* ]]; then
  echo "ok - lists the bot commands"
else
  echo "not ok - lists the bot commands"
  failures=$((failures + 1))
fi
if [[ "$output" == *"script-secret-token"* || "$output" == *"webhook-secret-with"* ]]; then
  echo "not ok - never prints the bot token or the secret"
  failures=$((failures + 1))
else
  echo "ok - never prints the bot token or the secret"
fi

FAKE_COMMANDS_RESPONSE='{"ok":false,"error_code":400,"description":"Bad Request"}'
output="$(register_telegram_webhook 2>&1)"
status=$?
assert_equal "keeps the webhook when only the commands menu fails" "0" "$status"
if [[ "$output" == *"commands menu was not updated"* ]]; then
  echo "ok - warns about the commands menu"
else
  echo "not ok - warns about the commands menu"
  failures=$((failures + 1))
fi
unset FAKE_COMMANDS_RESPONSE

FAKE_TELEGRAM_RESPONSE='{"ok":false,"error_code":401,"description":"Unauthorized"}'
assert_failure "fails when Telegram rejects the call" register_telegram_webhook
unset FAKE_TELEGRAM_RESPONSE

export TELEGRAM_WEBHOOK_SECRET="short"
assert_failure "rejects an unsafe secret" register_telegram_webhook

report_results
```

Run: `bash infra/scripts/telegram-webhook.test.sh`
Expected: FAIL на шагах «sends url, secret, allowed updates with buttons…» и «then updates the commands menu».

- [ ] **Step 2: Скрипт**

В `infra/scripts/telegram-webhook.sh` три правки.

1. В строке с `printf` для `payload` заменить

```bash
"allowed_updates":["message","my_chat_member"]
```

на:

```bash
"allowed_updates":["message","callback_query","my_chat_member"]
```

2. Блок

```bash
  echo "Telegram webhook registered at ${webhook_url}."
  return 0
}
```

заменить на:

```bash
  echo "Telegram webhook registered at ${webhook_url}."
  update_telegram_commands "$api_base_url"
  return 0
}

# update_telegram_commands <api-base-url>
# The menu is a convenience: a failure only warns, the webhook stays registered.
update_telegram_commands() {
  local commands_payload='{"commands":[{"command":"expense","description":"Расход"},{"command":"income","description":"Доход"},{"command":"transfer","description":"Перевод между счетами"},{"command":"event","description":"Событие календаря"},{"command":"last","description":"Последние операции"},{"command":"plans","description":"Плановые платежи на 7 дней"},{"command":"events","description":"События на 7 дней"},{"command":"balance","description":"Остатки и доступная сумма"},{"command":"cancel","description":"Отменить ввод"},{"command":"help","description":"Список команд"},{"command":"stop","description":"Отключить бота"}]}'
  local response
  if ! response="$(telegram_post "$1/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" "$commands_payload")" ||
    [[ "$response" != *'"ok":true'* ]]; then
    echo "Telegram bot commands menu was not updated; the webhook is registered." >&2
    return 0
  fi
  echo "Telegram bot commands menu updated."
}
```

3. Комментарий в начале файла дополнить второй строкой:

```bash
# Registers the Telegram bot webhook at ${WEB_BASE_URL}/api/v1/telegram/webhook.
# Then sets the bot commands menu (setMyCommands); a menu failure only warns.
```

Run: `bash infra/scripts/telegram-webhook.test.sh`
Expected: все строки `ok`, итог без `not ok`.

Run: `for test_file in infra/scripts/*.test.sh; do bash "$test_file" || exit 1; done`
Expected: PASS.

- [ ] **Step 3: E2E (только CI)**

В `e2e/telegram-notifications.spec.ts` две правки.

1. Блок

```ts
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
```

заменить на:

```ts
  const chatId = Date.now();
  const update = await request.post(`${apiV1}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    data: {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: chatId, type: 'private' },
        text: `/start ${code}`,
      },
    },
  });
```

2. Перед строкой

```ts
  await page.getByRole('button', { name: 'Отключить Telegram' }).click();
```

вставить:

```ts
  await expect(page.getByText('Команды выключены.')).toBeVisible();
  const enableCommands = page.getByRole('button', { name: 'Включить команды' });
  await expect(enableCommands).toBeDisabled();
  await page.getByLabel(/Я согласен включить команды бота/).check();
  await enableCommands.click();
  await expect(page.getByText('Команды включены.')).toBeVisible();

  // The reply goes to the closed port of TELEGRAM_API_BASE_URL in CI; the webhook still answers 200.
  const balance = await request.post(`${apiV1}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    data: {
      update_id: 2,
      message: { message_id: 2, chat: { id: chatId, type: 'private' }, text: '/balance' },
    },
  });
  expect(balance.status()).toBe(200);

```

Проверить, что спека компилируется, не запуская браузер. В корне нет бинаря `tsc`, поэтому команда запускается из `apps/api`:

Run: `cd apps/api && pnpm exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --types node ../../e2e/telegram-notifications.spec.ts`
Expected: без ошибок типов. Если команда падает из-за окружения, а не из-за кода спеки, записать это в «Ход выполнения»: CI проверит. Локально Playwright не запускать.

- [ ] **Step 4: Документация**

1. `docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md`: строку `Дата: 02.11.2026. Статус: согласован владельцем, не реализован.` заменить на `Дата: 02.11.2026. Статус: согласован владельцем, реализован.`.

2. `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`, раздел 18.3. Заменить строку

```markdown
> Уведомления в Telegram (привязка, выбор срочных и дайджеста, расписание, ссылки в приложение, согласие на суммы) перенесены в объём 31.10.2026 — реализовано, [дизайн](2026-10-31-telegram-notifications-design.md). Ввод операций и событий календаря из чата остаётся в развитии.
```

на:

```markdown
> Уведомления в Telegram (привязка, выбор срочных и дайджеста, расписание, ссылки в приложение, согласие на суммы) перенесены в объём 31.10.2026 — реализовано, [дизайн](2026-10-31-telegram-notifications-design.md). Команды бота — ввод расходов, доходов, переводов и событий календаря и просмотр операций, планов, событий и остатков — перенесены в объём 02.11.2026 и реализованы, [дизайн](2026-11-02-telegram-bot-commands-design.md).
```

Строку

```markdown
- позже: ввод операций и событий календаря из чата с подтверждением кнопкой, проверкой роли и идемпотентностью (отдельная спецификация).
```

заменить на:

```markdown
- ввод операций и событий календаря из чата с подтверждением кнопкой, проверкой роли и идемпотентностью — по отдельному согласию на команды бота.
```

3. Там же, в абзаце о порядке внешней доставки (раздел 18.6), заменить фразу `ввод через Telegram требует отдельного решения.` на `ввод через Telegram перенесён в объём решением владельца от 02.11.2026 ([дизайн](2026-11-02-telegram-bot-commands-design.md)).`.

4. `docs/runbooks/production-server-bootstrap.md`, пункт «Telegram-бот (необязательно)». После предложения `ошибка регистрации выводится предупреждением и не откатывает релиз.` добавить: `Тот же скрипт подписывает webhook на нажатия кнопок (callback_query) и обновляет меню команд бота (setMyCommands); если меню не обновилось, выводится предупреждение, а webhook остаётся. Команды бота каждый пользователь включает сам в настройках Telegram с отдельным согласием.`.

5. `README.md`:
   - в списке возможностей после строки `- внутренний центр уведомлений;` добавить строку `- команды Telegram-бота после отдельного согласия: ввод расходов, доходов, переводов и событий календаря по шагам и просмотр последних операций, планов, событий и остатков;`;
   - в «Ограничениях v1» удалить строку `- ввод операций и событий календаря через Telegram-бота (уведомления в Telegram реализованы);`.

6. `CLAUDE.md`:
   - в абзаце «Current scope and architecture» заменить `Telegram notifications (private chat linked by a one-time link),` на `Telegram notifications (private chat linked by a one-time link) and Telegram bot commands (step-by-step data entry and read-only views after a separate consent),`;
   - во втором абзаце заменить `Telegram data entry (Telegram notifications are implemented: see the [Telegram notifications design](docs/superpowers/specs/2026-10-31-telegram-notifications-design.md)), ` на пустую строку, то есть удалить этот фрагмент целиком вместе с запятой и пробелом;
   - в конец предложения о реализованных каналах дописать ссылку: заменить `web push notifications are implemented: see the [web push notifications design](docs/superpowers/specs/2026-11-02-web-push-notifications-design.md))` на `web push notifications are implemented: see the [web push notifications design](docs/superpowers/specs/2026-11-02-web-push-notifications-design.md); Telegram notifications and bot commands are implemented: see the [Telegram notifications design](docs/superpowers/specs/2026-10-31-telegram-notifications-design.md) and the [Telegram bot commands design](docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md))`.

Если какой-то из искомых фрагментов не найден дословно (документ мог измениться), остановиться и записать это в «Ход выполнения». Формулировку на глаз не придумывать.

Run: `pnpm exec prettier --check README.md CLAUDE.md docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/runbooks/production-server-bootstrap.md e2e/telegram-notifications.spec.ts`
Expected: PASS. Если упало, выполнить `--write`.

- [ ] **Step 5: Финальная проверка**

Выполнить блок «Финальная проверка» из [README](README.md) целиком.
Expected: всё зелёное, OpenAPI без `breaking change:`.

- [ ] **Step 6: Review по чек-листу**

Выполнить `git add infra/scripts/telegram-webhook.sh infra/scripts/telegram-webhook.test.sh e2e/telegram-notifications.spec.ts README.md CLAUDE.md docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/runbooks/production-server-bootstrap.md`, затем просмотреть `git diff --staged`.

- **release:**
  - без `callback_query` кнопки не работают, теперь он подписан;
  - сбой меню не валит деплой;
  - `deploy.sh` не менялся;
  - повторная регистрация идемпотентна.
- **security:**
  - скрипт по-прежнему не печатает токен и секрет;
  - E2E шлёт секрет только в заголовке;
  - документация не обещает лишнего: команды включаются только по согласию.
- **QA:**
  - bash-тест покрывает тело `setWebhook`, вызов `setMyCommands` и предупреждение;
  - E2E покрывает включение команд и ответ webhook 200;
  - финальная проверка пройдена.
- **final:**
  - документы согласованы: спецификация, 18.3, 18.6, README, CLAUDE.md;
  - лишних файлов нет.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): меню команд бота, E2E и документация"
```

Добавить строку в «Ход выполнения». Остановиться и сообщить владельцу: список коммитов `git log --oneline origin/main..HEAD`, результаты финальной проверки и отступления. Push и PR — только по решению владельца.
