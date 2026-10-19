#!/usr/bin/env bash
# Read-only release reference helpers shared by the release workflows. They only
# query git; nothing here pushes, tags or deploys.

readonly RELEASE_TAG_GLOB='v[0-9]*.[0-9]*.[0-9]*'

# normalize_release_version <input>
# Prints X.Y.Z for "X.Y.Z" or "vX.Y.Z"; fails silently for anything else.
normalize_release_version() {
  local input="$1"
  if [[ "$input" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

# package_version_at <commit>
# Prints the root package.json version recorded at the commit.
package_version_at() {
  local commit="$1"
  git show "${commit}:package.json" |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).version))'
}

# release_tag_at <commit>
# Prints the first vX.Y.Z tag pointing at the commit, or nothing.
release_tag_at() {
  local commit="$1"
  local tag
  while IFS= read -r tag; do
    if normalize_release_version "$tag" >/dev/null; then
      printf '%s\n' "$tag"
      return 0
    fi
  done < <(git tag --points-at "$commit" --list "$RELEASE_TAG_GLOB")
  return 0
}

# resolve_release <input>
# Prints "<full_sha> <version>" for a release version or a commit SHA. A SHA
# without a release tag reports the version "unreleased".
resolve_release() {
  local input="$1"
  local version sha tag

  if version="$(normalize_release_version "$input")"; then
    if ! sha="$(git rev-parse --verify --quiet "v${version}^{commit}")"; then
      echo "Release v${version} not found." >&2
      return 1
    fi
    printf '%s %s\n' "$sha" "$version"
    return 0
  fi

  if [[ "$input" =~ ^[0-9a-f]{7,40}$ ]]; then
    if ! sha="$(git rev-parse --verify --quiet "${input}^{commit}")"; then
      echo "Commit ${input} not found." >&2
      return 1
    fi
    tag="$(release_tag_at "$sha")"
    if [[ -n "$tag" ]]; then
      version="$(normalize_release_version "$tag")"
    else
      version="unreleased"
    fi
    printf '%s %s\n' "$sha" "$version"
    return 0
  fi

  echo "Expected a release version (X.Y.Z or vX.Y.Z) or a commit SHA: got \"${input}\"." >&2
  return 1
}

# resolve_tagged_commit <commit>
# Prints "<tag> <version>" when the commit carries a release tag, nothing when
# it does not. Fails when the tag disagrees with package.json at that commit.
resolve_tagged_commit() {
  local commit="$1"
  local tag version package_version

  tag="$(release_tag_at "$commit")"
  if [[ -z "$tag" ]]; then
    return 0
  fi

  version="$(normalize_release_version "$tag")"
  package_version="$(package_version_at "$commit")"
  if [[ "$package_version" != "$version" ]]; then
    echo "Tag ${tag} does not match package.json version ${package_version} at ${commit}." >&2
    return 1
  fi

  printf '%s %s\n' "$tag" "$version"
}
