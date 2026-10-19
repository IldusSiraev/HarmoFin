#!/usr/bin/env bash
# Validated SHA deployment orchestration: migration once, reconcile services,
# wait for health, run smoke. No automatic database rollback exists anywhere
# in this script — application rollback (prior SHA) is a separate, explicit
# operator decision outside this script.
set -uo pipefail

deploy_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$deploy_script_dir/lib.sh"
# shellcheck source=smoke.sh
source "$deploy_script_dir/smoke.sh"

readonly REQUIRED_DEPLOY_VARS=(WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATE_IMAGE IMAGE_TAG DATABASE_URL)

compose() {
  local compose_file="${COMPOSE_FILE:-infra/compose/production.yml}"
  local compose_args=(-f "$compose_file")

  if [[ -n "${COMPOSE_OVERRIDE_FILE:-}" ]]; then
    compose_args+=(-f "$COMPOSE_OVERRIDE_FILE")
  fi

  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    compose_args+=(--project-name "$COMPOSE_PROJECT_NAME")
  fi

  if [[ -n "${COMPOSE_ENV_FILE:-}" ]]; then
    compose_args+=(--env-file "$COMPOSE_ENV_FILE")
  fi

  docker compose "${compose_args[@]}" "$@"
}

# run_migration
# Runs the one-shot migrate container. Real implementation shells out to
# `docker compose run --rm migrate`; overridable in tests.
run_migration() {
  compose run --rm migrate
}

# reconcile_services
# Applies the current image tags to long-running services. Real implementation
# shells out to `docker compose up -d`; overridable in tests.
reconcile_services() {
  compose up -d web api worker caddy
}

# wait_for_services_healthy
# Polls Docker Compose health status for the long-running services. Real
# implementation checks `docker compose ps --format` output; overridable in
# tests.
wait_for_services_healthy() {
  local probe
  probe() {
    ! compose ps --format '{{.Health}}' web api worker caddy 2>/dev/null |
      grep -qv '^healthy$'
  }
  wait_for_healthy probe 30 2
}

# run_deploy_smoke
# Runs the non-destructive smoke checks against the deployed base URL.
# Overridable in tests.
run_deploy_smoke() {
  local base_url="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
  EXPECTED_REVISION="${IMAGE_TAG:-}" run_smoke_checks "$base_url"
}

# run_deploy
# Orchestrates one controlled deployment: validate -> migrate -> reconcile ->
# wait for health -> smoke. Stops before rollout on migration failure. Never
# runs a database rollback.
run_deploy() {
  if ! require_env_vars "${REQUIRED_DEPLOY_VARS[@]}"; then
    return 1
  fi

  if ! validate_image_tag "${IMAGE_TAG:-}"; then
    return 1
  fi

  echo "Running migration for SHA ${IMAGE_TAG}..."
  if ! run_migration; then
    echo "Migration failed. Stopping before rollout; current running services are left intact." >&2
    return 1
  fi

  echo "Reconciling services to SHA ${IMAGE_TAG}..."
  if ! reconcile_services; then
    echo "Service reconciliation failed." >&2
    return 1
  fi

  echo "Waiting for services to report healthy..."
  if ! wait_for_services_healthy; then
    echo "Services did not become healthy after reconciliation." >&2
    return 1
  fi

  echo "Running post-deploy smoke checks..."
  if ! run_deploy_smoke; then
    echo "Smoke checks failed after deployment." >&2
    return 1
  fi

  echo "Deployment of SHA ${IMAGE_TAG} completed successfully."
  return 0
}

# run_rollback <current_tag> <previous_tag> <migration_compatible>
# Reconciles services to a previously verified SHA. Never runs migration and
# never touches the database — this is an application-only rollback. Refuses
# unless a previous SHA is given and migration compatibility with it was
# explicitly confirmed by the caller.
run_rollback() {
  local current_tag="$1"
  local previous_tag="${2:-}"
  local migration_compatible="${3:-}"
  local selected_tag

  if ! selected_tag="$(select_rollback_tag "$current_tag" "$previous_tag" "$migration_compatible")"; then
    return 1
  fi

  export IMAGE_TAG="$selected_tag"

  echo "Rolling back application services from ${current_tag} to ${selected_tag}..."
  if ! reconcile_services; then
    echo "Rollback service reconciliation failed." >&2
    return 1
  fi

  echo "Waiting for services to report healthy after rollback..."
  if ! wait_for_services_healthy; then
    echo "Services did not become healthy after rollback." >&2
    return 1
  fi

  echo "Running post-rollback smoke checks..."
  if ! run_deploy_smoke; then
    echo "Smoke checks failed after rollback." >&2
    return 1
  fi

  echo "Rollback to SHA ${selected_tag} completed successfully."
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_deploy
fi
