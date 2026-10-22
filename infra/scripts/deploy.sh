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

# current_release_tag
# Prints the image tag the running api service uses now, or nothing when it is
# not running. Read before reconcile, so it names the release being replaced.
# Overridable in tests.
current_release_tag() {
  local image
  image="$(compose ps --format '{{.Image}}' api 2>/dev/null | head -n 1)"
  if [[ "$image" == "${API_IMAGE:-}:"* ]]; then
    printf '%s' "${image#"${API_IMAGE}:"}"
  fi
}

# remove_old_release_images <current_tag> [previous_tag]
# Removes this project's release images (WEB/API/WORKER/MIGRATE repositories
# only) except the current tag and the previous one kept for an application
# rollback. Every release pulls new images and nothing removed the old ones, so
# they filled the disk. Images of other projects on the host are never touched;
# no force removal, so an image a container still uses is skipped. A failure
# here never fails the deployment that already succeeded.
remove_old_release_images() {
  local current_tag="$1"
  local previous_tag="${2:-}"
  local repository reference tag

  for repository in "$WEB_IMAGE" "$API_IMAGE" "$WORKER_IMAGE" "$MIGRATE_IMAGE"; do
    while IFS= read -r reference; do
      tag="${reference#"${repository}:"}"
      if [[ -z "$tag" || "$tag" == "<none>" || "$tag" == "$current_tag" || "$tag" == "$previous_tag" ]]; then
        continue
      fi
      if docker image rm "$reference" >/dev/null 2>&1; then
        echo "Removed old image $reference"
      else
        echo "Could not remove old image $reference; skipped." >&2
      fi
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository" 2>/dev/null)
  done
  return 0
}

# run_deploy
# Orchestrates one controlled deployment: validate -> migrate -> reconcile ->
# wait for health -> smoke -> remove old release images. Stops before rollout
# on migration failure. Never runs a database rollback.
run_deploy() {
  local previous_tag

  if ! require_env_vars "${REQUIRED_DEPLOY_VARS[@]}"; then
    return 1
  fi

  if ! validate_image_tag "${IMAGE_TAG:-}"; then
    return 1
  fi

  previous_tag="$(current_release_tag)"

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

  echo "Removing old release images (keeping ${IMAGE_TAG}${previous_tag:+ and ${previous_tag}})..."
  remove_old_release_images "$IMAGE_TAG" "$previous_tag" || true

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
