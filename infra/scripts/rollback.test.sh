#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/lib.sh"
source "$script_dir/deploy.sh"

# run_rollback refuses without a previous SHA.
output="$(run_rollback "current-sha" "" "true" 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ "$output" == *"No previous SHA"* ]]; then
  echo "ok - run_rollback refuses when there is no previous SHA"
else
  echo "not ok - run_rollback refuses when there is no previous SHA (status=$status, output=$output)"
  failures=$((failures + 1))
fi

# run_rollback refuses without explicit migration compatibility confirmation.
output="$(run_rollback "current-sha" "previous-sha" "false" 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ "$output" == *"compatibility"* ]]; then
  echo "ok - run_rollback refuses without migration compatibility confirmation"
else
  echo "not ok - run_rollback refuses without migration compatibility confirmation (status=$status, output=$output)"
  failures=$((failures + 1))
fi

# run_rollback deploys the previous SHA (never runs migration, never touches the database) when confirmed.
export WEB_IMAGE="registry.invalid/web"
export API_IMAGE="registry.invalid/api"
export WORKER_IMAGE="registry.invalid/worker"
export MIGRATE_IMAGE="registry.invalid/migrate"
export DATABASE_URL="postgresql://user:pw@db.invalid/harmofin"

reconcile_flag="$(mktemp)"
migration_flag="$(mktemp)"
image_tag_file="$(mktemp)"
rm -f "$reconcile_flag" "$migration_flag" "$image_tag_file"

run_migration() { touch "$migration_flag"; return 0; }
reconcile_services() { touch "$reconcile_flag"; printf '%s' "$IMAGE_TAG" >"$image_tag_file"; return 0; }
wait_for_services_healthy() { return 0; }
run_deploy_smoke() { return 0; }

output="$(run_rollback "current-sha" "previous-sha" "true" 2>&1)"
status=$?
observed_tag="$(cat "$image_tag_file" 2>/dev/null || echo "")"
if [[ "$status" -eq 0 ]] && [[ "$observed_tag" == "previous-sha" ]] && [[ -f "$reconcile_flag" ]] && [[ ! -f "$migration_flag" ]]; then
  echo "ok - run_rollback reconciles to the previous SHA without running migration"
else
  echo "not ok - run_rollback reconciles to the previous SHA without running migration (status=$status, observed_tag=$observed_tag, reconcile_ran=$([[ -f "$reconcile_flag" ]] && echo yes || echo no), migration_ran=$([[ -f "$migration_flag" ]] && echo yes || echo no))"
  failures=$((failures + 1))
fi
rm -f "$reconcile_flag" "$migration_flag" "$image_tag_file"

report_results
