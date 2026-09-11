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
if [[ "$status" -ne 0 ]] && [[ -f "$reconcile_flag" ]] && [[ ! -f "$smoke_flag" ]]; then
  echo "ok - run_deploy fails when services do not become healthy and skips smoke"
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

eval "$env_backup"

report_results
