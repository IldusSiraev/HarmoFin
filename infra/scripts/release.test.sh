#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/test-helpers.sh"
source "$script_dir/release.sh"

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo" || exit 1

git init -q
git config user.email test@example.invalid
git config user.name test

commit_with_version() {
  printf '{\n  "name": "harmofin",\n  "version": "%s"\n}\n' "$1" > package.json
  git add package.json
  git commit -q -m "chore: version $1"
  git rev-parse HEAD
}

released_sha="$(commit_with_version 1.2.3)"
git tag v1.2.3
unreleased_sha="$(commit_with_version 1.2.3-next)"
mismatched_sha="$(commit_with_version 1.3.0)"
git tag v1.4.0

# normalize_release_version
assert_equal "normalize_release_version accepts X.Y.Z" "1.2.3" "$(normalize_release_version 1.2.3)"
assert_equal "normalize_release_version strips the v prefix" "1.2.3" "$(normalize_release_version v1.2.3)"
assert_failure "normalize_release_version rejects a SHA" normalize_release_version abc1234
assert_failure "normalize_release_version rejects a partial version" normalize_release_version 1.2

# package_version_at / release_tag_at
assert_equal "package_version_at reads package.json at a commit" "1.2.3" "$(package_version_at "$released_sha")"
assert_equal "release_tag_at finds the release tag" "v1.2.3" "$(release_tag_at "$released_sha")"
assert_equal "release_tag_at is empty for an untagged commit" "" "$(release_tag_at "$unreleased_sha")"

# resolve_release
assert_equal "resolve_release maps a version to its tagged SHA" \
  "$released_sha 1.2.3" "$(resolve_release 1.2.3)"
assert_equal "resolve_release maps a v-prefixed version to its tagged SHA" \
  "$released_sha 1.2.3" "$(resolve_release v1.2.3)"
assert_equal "resolve_release expands a short SHA and finds its version" \
  "$released_sha 1.2.3" "$(resolve_release "${released_sha:0:7}")"
assert_equal "resolve_release marks an untagged SHA as unreleased" \
  "$unreleased_sha unreleased" "$(resolve_release "$unreleased_sha")"
assert_failure "resolve_release rejects an unknown version" resolve_release 9.9.9
assert_failure "resolve_release rejects an unknown SHA" resolve_release deadbeef
assert_failure "resolve_release rejects a mutable tag name" resolve_release latest

output="$(resolve_release 9.9.9 2>&1 || true)"
case "$output" in
  *"v9.9.9 not found"*) echo "ok - resolve_release names the missing release" ;;
  *)
    echo "not ok - resolve_release names the missing release (got: $output)"
    failures=$((failures + 1))
    ;;
esac

# resolve_tagged_commit
assert_equal "resolve_tagged_commit reports the tag and version" \
  "v1.2.3 1.2.3" "$(resolve_tagged_commit "$released_sha")"
assert_equal "resolve_tagged_commit is empty for an untagged commit" \
  "" "$(resolve_tagged_commit "$unreleased_sha")"
assert_failure "resolve_tagged_commit rejects a tag that disagrees with package.json" \
  resolve_tagged_commit "$mismatched_sha"

report_results
