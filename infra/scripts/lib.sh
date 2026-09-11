#!/usr/bin/env bash
# Pure decision-logic helpers for deploy.sh and smoke.sh. No side effects,
# no docker/network calls, so they can be unit tested by sourcing this file.

# validate_image_tag <tag>
# Rejects empty, "latest", or any value that is not a hex git commit SHA
# (7-40 hex chars). Prints an error to stderr and returns 1 on rejection.
validate_image_tag() {
  local tag="${1:-}"

  if [[ -z "$tag" ]]; then
    echo "IMAGE_TAG is required." >&2
    return 1
  fi

  if [[ "$tag" == "latest" ]]; then
    echo "IMAGE_TAG must not be the mutable tag \"latest\"." >&2
    return 1
  fi

  if ! [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "IMAGE_TAG must be a hex commit SHA (7-40 characters): got \"$tag\"." >&2
    return 1
  fi

  return 0
}

# require_env_var <name>
# Fails with a clear message if the named environment variable is unset or empty.
require_env_var() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    echo "Required environment variable $name is not set." >&2
    return 1
  fi

  return 0
}

# require_env_vars <name...>
# Validates a list of required environment variables, reporting every missing
# one before returning failure.
require_env_vars() {
  local missing=0
  local name

  for name in "$@"; do
    if ! require_env_var "$name"; then
      missing=1
    fi
  done

  [[ "$missing" -eq 0 ]]
}

# select_rollback_tag <current_tag> <previous_tag> <migration_compatible>
# Returns the previous tag on stdout only when a previous tag is provided AND
# migration compatibility was explicitly confirmed ("true"). Otherwise prints
# nothing and returns 1, signalling that no automatic rollback is safe.
select_rollback_tag() {
  local previous_tag="${2:-}"
  local migration_compatible="${3:-}"

  if [[ -z "$previous_tag" ]]; then
    echo "No previous SHA available; nothing to roll back to." >&2
    return 1
  fi

  if [[ "$migration_compatible" != "true" ]]; then
    echo "Migration compatibility not confirmed; refusing automatic rollback." >&2
    return 1
  fi

  printf '%s\n' "$previous_tag"
  return 0
}

# redact_release_metadata <json>
# Strips any key commonly associated with secrets from a flat JSON object
# before it is written to release evidence output. Defensive-in-depth: deploy.sh
# only ever builds metadata from non-secret values, but this guards against a
# future field accidentally carrying one.
redact_release_metadata() {
  local json="$1"
  local pattern='"(password|secret|token|databaseUrl|database_url|dsn|apiKey|api_key)"[[:space:]]*:[[:space:]]*"[^"]*"'

  echo "$json" | sed -E "s/${pattern}/\"\\1\":\"[REDACTED]\"/gi"
}
