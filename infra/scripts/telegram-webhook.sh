#!/usr/bin/env bash
# Registers the Telegram bot webhook at ${WEB_BASE_URL}/api/v1/telegram/webhook.
# Then sets the bot commands menu (setMyCommands); a menu failure only warns.
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
  # Same rule as the plan's {32,256}: MSYS bash 5.2 regex breaks {n,m} quantifiers.
  local secret="${TELEGRAM_WEBHOOK_SECRET:-}"
  if [[ ! "$secret" =~ ^[A-Za-z0-9_-]+$ ]] || (( ${#secret} < 32 || ${#secret} > 256 )); then
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
  payload="$(printf '{"url":"%s","secret_token":"%s","allowed_updates":["message","callback_query","my_chat_member"],"drop_pending_updates":true}' \
    "$webhook_url" "$secret")"

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

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  register_telegram_webhook
fi
