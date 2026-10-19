#!/usr/bin/env bash
# Non-destructive post-deploy health/smoke checks. No writes, no mutations,
# no destructive database operations. Only reads probe endpoints.

# wait_for_healthy <probe_fn> <max_attempts> <sleep_seconds>
# Calls probe_fn repeatedly (up to max_attempts) until it returns success.
# probe_fn receives no arguments and must return 0 for healthy, non-zero
# otherwise. Fails with an explicit message when retries are exhausted.
wait_for_healthy() {
  local probe_fn="$1"
  local max_attempts="${2:-30}"
  local sleep_seconds="${3:-2}"
  local attempt

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if "$probe_fn"; then
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done

  echo "Service did not become healthy after $max_attempts attempt(s)." >&2
  return 1
}

# check_http_status <curl_fn> <url> <expected_status>
# curl_fn is injected so tests can fake network calls; production callers
# pass a function that runs `curl -s -o /dev/null -w '%{http_code}' "$url"`.
check_http_status() {
  local curl_fn="$1"
  local url="$2"
  local expected_status="$3"
  local actual_status

  actual_status="$("$curl_fn" "$url")"

  if [[ "$actual_status" != "$expected_status" ]]; then
    echo "Expected HTTP $expected_status from $url, got $actual_status." >&2
    return 1
  fi

  return 0
}

# curl_status <url>
# Real curl_fn implementation used by production callers.
curl_status() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url"
}

# curl_body <url>
# Real body fetcher used by production callers of check_api_revision.
curl_body() {
  local url="$1"
  curl -s --max-time 5 "$url"
}

# check_api_revision <body_fn> <url> <expected_revision>
# Reads the API liveness body and compares its "revision" with the deployed
# SHA. Releases built before revision reporting omit the field; they pass with
# a warning so rollbacks to them still work.
check_api_revision() {
  local body_fn="$1"
  local url="$2"
  local expected_revision="$3"
  local actual_revision

  actual_revision="$("$body_fn" "$url" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')"

  if [[ -z "$actual_revision" ]]; then
    echo "Warning: $url does not report a revision; skipping revision check." >&2
    return 0
  fi

  if [[ "$actual_revision" != "$expected_revision" ]]; then
    echo "Expected revision $expected_revision from $url, got $actual_revision." >&2
    return 1
  fi

  return 0
}

# run_smoke_checks <base_url>
# Verifies liveness/readiness for web (via Caddy) and API through the public
# same-origin routes only. Does not touch worker/metrics private ports.
run_smoke_checks() {
  local base_url="$1"

  echo "Checking web liveness at $base_url/health/live"
  check_http_status curl_status "$base_url/health/live" 200 || return 1

  echo "Checking API liveness at $base_url/api/v1/health/live"
  check_http_status curl_status "$base_url/api/v1/health/live" 200 || return 1

  echo "Checking API readiness at $base_url/api/v1/health/ready"
  check_http_status curl_status "$base_url/api/v1/health/ready" 200 || return 1

  if [[ -n "${EXPECTED_REVISION:-}" ]]; then
    echo "Checking API revision at $base_url/api/v1/health/live"
    check_api_revision curl_body "$base_url/api/v1/health/live" "$EXPECTED_REVISION" || return 1
  fi

  echo "Smoke checks passed for $base_url"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <base_url>" >&2
    exit 2
  fi
  run_smoke_checks "$1"
fi
