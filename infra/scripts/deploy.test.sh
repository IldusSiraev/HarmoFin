#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/lib.sh"
source "$script_dir/deploy.sh"

# run_deploy validates required inputs before doing anything else.
env_backup="$(declare -p WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATE_IMAGE IMAGE_TAG DATABASE_URL 2>/dev/null || true)"

unset WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATE_IMAGE IMAGE_TAG DATABASE_URL
output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ "$output" == *"IMAGE_TAG"* ]]; then
  echo "ok - run_deploy fails fast when required variables are missing"
else
  echo "not ok - run_deploy fails fast when required variables are missing (status=$status, output=$output)"
  failures=$((failures + 1))
fi

# run_deploy rejects a mutable "latest" tag even when other vars are present.
export WEB_IMAGE="registry.invalid/web"
export API_IMAGE="registry.invalid/api"
export WORKER_IMAGE="registry.invalid/worker"
export MIGRATE_IMAGE="registry.invalid/migrate"
export DATABASE_URL="postgresql://user:pw@db.invalid/harmofin"
export IMAGE_TAG="latest"
output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ "$output" == *"latest"* ]]; then
  echo "ok - run_deploy rejects a mutable \"latest\" image tag"
else
  echo "not ok - run_deploy rejects a mutable \"latest\" image tag (status=$status, output=$output)"
  failures=$((failures + 1))
fi

# run_deploy stops before rollout when migration fails, and never calls reconcile.
# Call flags are written to temp files: `output="$(run_deploy ...)"` runs
# run_deploy in a subshell, so plain variable assignments inside it would not
# be visible here.
export IMAGE_TAG="a1b2c3d"
# Stubs for the old-image cleanup: no Docker calls from the orchestration tests.
cleanup_args="$(mktemp)"
current_release_tag() { printf 'f0e1d2c'; }
remove_old_release_images() { printf '%s\n' "$*" > "$cleanup_args"; return 0; }
reconcile_flag="$(mktemp)"
smoke_flag="$(mktemp)"
rm -f "$reconcile_flag" "$smoke_flag"

run_migration() { return 1; }
reconcile_services() { touch "$reconcile_flag"; return 0; }
wait_for_services_healthy() { return 0; }
run_deploy_smoke() { touch "$smoke_flag"; return 0; }

output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ ! -f "$reconcile_flag" ]] && [[ "$output" == *"Migration failed"* ]]; then
  echo "ok - run_deploy stops before rollout when migration fails"
else
  echo "not ok - run_deploy stops before rollout when migration fails (status=$status, reconcile_ran=$([[ -f "$reconcile_flag" ]] && echo yes || echo no), output=$output)"
  failures=$((failures + 1))
fi
rm -f "$reconcile_flag" "$smoke_flag"

# run_deploy reports explicit failure when services do not become healthy, without running smoke.
run_migration() { return 0; }
reconcile_services() { touch "$reconcile_flag"; return 0; }
wait_for_services_healthy() { return 1; }
run_deploy_smoke() { touch "$smoke_flag"; return 0; }

output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ -f "$reconcile_flag" ]] && [[ ! -f "$smoke_flag" ]] && [[ ! -s "$cleanup_args" ]]; then
  echo "ok - run_deploy fails when services do not become healthy and skips smoke and cleanup"
else
  echo "not ok - run_deploy fails when services do not become healthy and skips smoke (status=$status, reconcile_ran=$([[ -f "$reconcile_flag" ]] && echo yes || echo no), smoke_ran=$([[ -f "$smoke_flag" ]] && echo yes || echo no))"
  failures=$((failures + 1))
fi
rm -f "$reconcile_flag" "$smoke_flag"

# run_deploy succeeds end to end when migration, health and smoke all pass.
run_migration() { return 0; }
reconcile_services() { return 0; }
wait_for_services_healthy() { return 0; }
run_deploy_smoke() { touch "$smoke_flag"; return 0; }

output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -eq 0 ]] && [[ -f "$smoke_flag" ]]; then
  echo "ok - run_deploy succeeds end to end and runs smoke checks"
else
  echo "not ok - run_deploy succeeds end to end and runs smoke checks (status=$status, smoke_ran=$([[ -f "$smoke_flag" ]] && echo yes || echo no))"
  failures=$((failures + 1))
fi
rm -f "$reconcile_flag" "$smoke_flag"
assert_equal "run_deploy removes old images keeping the new and the replaced release" \
  "a1b2c3d f0e1d2c" "$(cat "$cleanup_args")"

# A failed cleanup does not fail a deployment that already succeeded.
remove_old_release_images() { return 1; }
output="$(run_deploy 2>&1)"
status=$?
assert_equal "run_deploy stays successful when old image cleanup fails" "0" "$status"

# Smoke failure: the release is not confirmed, nothing is removed.
: > "$cleanup_args"
remove_old_release_images() { printf '%s\n' "$*" > "$cleanup_args"; return 0; }
run_deploy_smoke() { return 1; }
output="$(run_deploy 2>&1)"
status=$?
if [[ "$status" -ne 0 ]] && [[ ! -s "$cleanup_args" ]]; then
  echo "ok - run_deploy removes no images when smoke checks fail"
else
  echo "not ok - run_deploy removes no images when smoke checks fail (status=$status)"
  failures=$((failures + 1))
fi
rm -f "$cleanup_args"

# run_deploy never invokes a database rollback function, by construction:
# confirm no such function is defined/sourced anywhere in deploy.sh.
if declare -F | grep -qi 'rollback.*database\|database.*rollback'; then
  echo "not ok - deploy.sh must not define any database rollback function"
  failures=$((failures + 1))
else
  echo "ok - deploy.sh defines no database rollback function"
fi

# Compose commands must receive the external environment file used on the
# staging host; otherwise Docker Compose silently ignores injected secrets.
fake_bin="$(mktemp -d)"
captured_args="$(mktemp)"
cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CAPTURED_ARGS"
EOF
chmod +x "$fake_bin/docker"
CAPTURED_ARGS="$captured_args" PATH="$fake_bin:$PATH" COMPOSE_FILE="production.yml" COMPOSE_OVERRIDE_FILE="override.yml" COMPOSE_ENV_FILE="/run/secrets/staging.env" COMPOSE_PROJECT_NAME="staging-test" \
  bash -c 'source infra/scripts/deploy.sh; run_migration' >/dev/null 2>&1
if grep -Fq -- "--env-file /run/secrets/staging.env" "$captured_args"; then
  echo "ok - Compose commands use the external environment file"
else
  echo "not ok - Compose commands use the external environment file"
  failures=$((failures + 1))
fi
if grep -Fq -- "--project-name staging-test" "$captured_args"; then
  echo "ok - Compose commands use the configured project name"
else
  echo "not ok - Compose commands use the configured project name"
  failures=$((failures + 1))
fi
if grep -Fq -- "-f override.yml" "$captured_args"; then
  echo "ok - Compose commands include an optional override file"
else
  echo "not ok - Compose commands include an optional override file"
  failures=$((failures + 1))
fi
rm -rf "$fake_bin" "$captured_args"

# remove_old_release_images: only this project's repositories, never the kept
# tags or untagged entries, no force removal. Real function from a fresh shell
# with a fake docker on PATH.
fake_bin="$(mktemp -d)"
removed_refs="$(mktemp)"
cat >"$fake_bin/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ "$1 $2" == "image ls" ]]; then
  case "${@: -1}" in
    registry.invalid/web) printf '%s\n' registry.invalid/web:new1 registry.invalid/web:old1 registry.invalid/web:prev1 'registry.invalid/web:<none>' ;;
    registry.invalid/api) printf '%s\n' registry.invalid/api:old1 registry.invalid/api:old2 ;;
  esac
elif [[ "$1 $2" == "image rm" ]]; then
  printf '%s\n' "${*:3}" >> "$REMOVED_REFS"
  [[ "$3" != registry.invalid/api:old2 ]]
fi
DOCKER
chmod +x "$fake_bin/docker"
cleanup_output="$(
  REMOVED_REFS="$removed_refs" PATH="$fake_bin:$PATH" WEB_IMAGE=registry.invalid/web API_IMAGE=registry.invalid/api \
    WORKER_IMAGE=registry.invalid/worker MIGRATE_IMAGE=registry.invalid/migrate \
    bash -c 'source infra/scripts/deploy.sh; remove_old_release_images new1 prev1' 2>&1
)"
cleanup_status=$?
assert_equal "remove_old_release_images removes only old tags of project images" \
  "registry.invalid/web:old1 registry.invalid/api:old1 registry.invalid/api:old2" \
  "$(tr '\n' ' ' < "$removed_refs" | sed 's/ $//')"
assert_equal "remove_old_release_images succeeds when one image cannot be removed" "0" "$cleanup_status"
if [[ "$cleanup_output" == *"Could not remove old image registry.invalid/api:old2"* ]]; then
  echo "ok - remove_old_release_images reports a skipped image"
else
  echo "not ok - remove_old_release_images reports a skipped image (output=$cleanup_output)"
  failures=$((failures + 1))
fi
rm -rf "$fake_bin" "$removed_refs"

# current_release_tag: the tag of the running api image; nothing for another image.
fake_bin="$(mktemp -d)"
cat >"$fake_bin/docker" <<'DOCKER'
#!/usr/bin/env bash
printf '%s\n' "$FAKE_API_IMAGE"
DOCKER
chmod +x "$fake_bin/docker"
running_tag="$(
  FAKE_API_IMAGE=registry.invalid/api:9f8e7d6 API_IMAGE=registry.invalid/api PATH="$fake_bin:$PATH" \
    bash -c 'source infra/scripts/deploy.sh; current_release_tag'
)"
assert_equal "current_release_tag reads the running api image tag" "9f8e7d6" "$running_tag"
foreign_tag="$(
  FAKE_API_IMAGE=other.invalid/app:1 API_IMAGE=registry.invalid/api PATH="$fake_bin:$PATH" \
    bash -c 'source infra/scripts/deploy.sh; current_release_tag'
)"
assert_equal "current_release_tag ignores an image from another repository" "" "$foreign_tag"
rm -rf "$fake_bin"

eval "$env_backup"

# run_deploy_smoke: smoke expects the revision that was just deployed
# Runs in a fresh subshell that sources deploy.sh anew: earlier tests in this
# file redefined run_deploy_smoke itself, so the real function (not a leftover
# stub) must be exercised here.
captured_expected_revision="$(
  IMAGE_TAG=abc1234 SMOKE_BASE_URL=http://example.invalid \
    bash -c 'source infra/scripts/deploy.sh; run_smoke_checks() { echo "$EXPECTED_REVISION"; }; run_deploy_smoke'
)"
assert_equal "run_deploy_smoke expects the deployed revision" "abc1234" "$captured_expected_revision"

report_results
