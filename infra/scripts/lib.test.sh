#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/lib.sh"

# validate_image_tag
assert_failure "validate_image_tag rejects an empty tag" validate_image_tag ""
assert_failure "validate_image_tag rejects the mutable tag \"latest\"" validate_image_tag "latest"
assert_failure "validate_image_tag rejects a non-hex value" validate_image_tag "not-a-sha!"
assert_success "validate_image_tag accepts a full 40-char hex SHA" \
  validate_image_tag "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
assert_success "validate_image_tag accepts a short 7-char hex SHA" validate_image_tag "a1b2c3d"

# require_env_vars
unset REQUIRED_ONE REQUIRED_TWO
assert_failure "require_env_vars fails when a variable is unset" require_env_vars REQUIRED_ONE
REQUIRED_ONE="value"
REQUIRED_TWO="value"
assert_success "require_env_vars passes when all variables are set" require_env_vars REQUIRED_ONE REQUIRED_TWO

# select_rollback_tag
assert_failure "select_rollback_tag refuses when there is no previous tag" \
  select_rollback_tag "current-sha" "" "true"
assert_failure "select_rollback_tag refuses when migration compatibility is unconfirmed" \
  select_rollback_tag "current-sha" "previous-sha" "false"
rollback_result="$(select_rollback_tag "current-sha" "previous-sha" "true")"
assert_equal "select_rollback_tag returns the previous tag when confirmed" "previous-sha" "$rollback_result"

# redact_release_metadata
redacted="$(redact_release_metadata '{"sha":"abc123","databaseUrl":"postgresql://user:pw@host/db"}')"
assert_equal "redact_release_metadata masks a databaseUrl field" \
  '{"sha":"abc123","databaseUrl":"[REDACTED]"}' "$redacted"

report_results
