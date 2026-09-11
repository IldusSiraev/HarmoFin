#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/smoke.sh"

# wait_for_healthy: succeeds once the probe reports healthy within retries
healthy_after=2
attempt=0
probe_eventually_healthy() {
  attempt=$((attempt + 1))
  [[ "$attempt" -ge "$healthy_after" ]]
}
assert_success "wait_for_healthy succeeds once probe reports healthy" \
  wait_for_healthy probe_eventually_healthy 5 0

# wait_for_healthy: fails with a clear message when probe never succeeds
probe_always_unhealthy() {
  return 1
}
assert_failure "wait_for_healthy fails when probe never succeeds within retries" \
  wait_for_healthy probe_always_unhealthy 2 0

output="$(wait_for_healthy probe_always_unhealthy 2 0 2>&1 || true)"
case "$output" in
  *"did not become healthy"*) echo "ok - wait_for_healthy reports an explicit unhealthy failure" ;;
  *)
    echo "not ok - wait_for_healthy reports an explicit unhealthy failure (got: $output)"
    failures=$((failures + 1))
    ;;
esac

# check_http_status: succeeds when curl reports the expected status code
fake_curl_200() {
  echo "200"
}
assert_success "check_http_status succeeds on matching status code" \
  check_http_status fake_curl_200 "http://example.invalid/health/live" 200

fake_curl_503() {
  echo "503"
}
assert_failure "check_http_status fails on mismatched status code" \
  check_http_status fake_curl_503 "http://example.invalid/health/ready" 200

report_results
