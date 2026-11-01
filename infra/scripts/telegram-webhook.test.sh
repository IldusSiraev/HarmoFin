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
