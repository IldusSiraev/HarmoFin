#!/usr/bin/env bash
# Minimal TAP-like assertion helpers shared by infra/scripts/*.test.sh files.

failures=0

assert_success() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok - $description"
  else
    echo "not ok - $description"
    failures=$((failures + 1))
  fi
}

assert_failure() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "not ok - $description (expected failure, got success)"
    failures=$((failures + 1))
  else
    echo "ok - $description"
  fi
}

assert_equal() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "ok - $description"
  else
    echo "not ok - $description (expected \"$expected\", got \"$actual\")"
    failures=$((failures + 1))
  fi
}

report_results() {
  if [[ "$failures" -gt 0 ]]; then
    echo "$failures assertion(s) failed."
    exit 1
  fi

  echo "All assertions passed."
}
