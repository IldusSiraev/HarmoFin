# Версионирование и выпуск релизов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Единый SemVer для HarmoFin: Release PR через release-please, тег версии на опубликованных образах, деплой production по версии, версия в `/api/v1/health/live` и в настройках веба.

**Architecture:** release-please на `main` поддерживает Release PR и после его мержа ставит тег `vX.Y.Z`. Образ коммита из Release PR уже несёт версию (`APP_VERSION` запекается при сборке из корневого `package.json`), отдельный workflow добавляет образам тег `X.Y.Z` без пересборки. `deploy-production` резолвит версию в SHA общим shell-хелпером `infra/scripts/release.sh`; `deploy.sh`/rollback по-прежнему работают по SHA. Smoke сверяет ревизию из health с развёрнутым SHA.

**Tech Stack:** GitHub Actions, release-please-action v5, actions/create-github-app-token v3, Docker Buildx imagetools, bash, NestJS 11/Fastify, Nuxt 4/Vue 3.5, Vitest, `node:test`.

**Spec:** [docs/superpowers/specs/2026-10-19-release-versioning-design.md](../specs/2026-10-19-release-versioning-design.md)

## Global Constraints

- Работа на ветке `feat/release-versioning` в текущем checkout; worktree не создавать.
- Коммит, push, PR — только после явного одобрения владельца. Шаги «Commit» ниже выполняются, только если владелец разрешил коммиты для этой задачи; иначе изменения остаются в рабочем дереве.
- Локальный Playwright не запускать.
- Версия: единый SemVer `vX.Y.Z`, теги без компонента, первый релиз `1.0.0`.
- Тег `latest` нигде не создаётся; production деплоит неизменяемый SHA-образ.
- Все сторонние actions закреплены по 40-символьному commit SHA с комментарием версии:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e # v4.3.0`
  - `actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0`
  - `googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0`
- Значения из `inputs.*`/`github.event.*` в `run:` передаются только через `env:`, не подставляются в скрипт напрямую.
- Пользовательский текст UI и документация — на русском; идентификаторы, логи shell-скриптов и API — на английском (как в существующих скриптах).
- `/api/v1` меняется только аддитивно.
- Не трогать `identity/logo_description.png`.

## Файлы

| Файл | Действие | Ответственность |
|---|---|---|
| `.github/workflows/ci.yml` | изменить | запуск `infra/scripts/*.test.mjs` и `*.test.sh` |
| `infra/scripts/workflow.production.test.mjs` | изменить | актуальные проверки production workflow |
| `package.json` | изменить | поле `version` — источник истины |
| `release-please-config.json` | создать | конфиг release-please |
| `.release-please-manifest.json` | создать | текущая версия |
| `.prettierignore` | изменить | исключить генерируемые `CHANGELOG.md` и манифест |
| `.github/workflows/release.yml` | создать | Release PR / тег / GitHub Release |
| `scripts/ci/release-config.test.mjs` | создать | инварианты конфига и версий пакетов |
| `infra/scripts/release.sh` | создать | резолв версии/SHA и проверка тега |
| `infra/scripts/release.test.sh` | создать | тесты `release.sh` на временном git-репозитории |
| `infra/docker/Dockerfile`, `infra/docker/docker-bake.hcl` | изменить | `APP_VERSION` в образе |
| `.github/workflows/publish.yml` | изменить | build-arg и label версии |
| `.github/workflows/tag-release-images.yml` | создать | тег `X.Y.Z` на образах |
| `.github/workflows/deploy-production.yml` | изменить | вход `release`, резолв в SHA |
| `infra/scripts/workflow.test.mjs` | изменить | проверки новых/изменённых workflows |
| `infra/scripts/workflow-test-helpers.mjs` | создать | `runBlocks()` — тексты `run:`-блоков workflow для тестов |
| `apps/api/src/config/env.ts` (+ тестовые фикстуры `ApiConfig`) | изменить | `appVersion` |
| `apps/api/src/health/*` | изменить | `version`/`revision` в `/health/live` |
| `apps/api/src/app.module.ts` | изменить | `HealthModule.register(config)` |
| `openapi.json` | регенерировать | контракт |
| `infra/scripts/smoke.sh`, `deploy.sh` (+ тесты) | изменить | проверка ревизии |
| `apps/web/nuxt.config.ts`, `apps/web/app/pages/app/settings/index.vue` (+ тест, stub) | изменить | строка «Версия …» |
| `README.md`, `docs/runbooks/release.md`, `docs/runbooks/deploy.md`, dev spec | изменить/создать | документация |

---

### Task 1: Подключить infra-тесты к CI и починить устаревший тест production workflow

Сейчас `infra/scripts/*.test.mjs` и `*.test.sh` в CI не запускаются, а `workflow.production.test.mjs` падает в трёх тестах: ждёт `staging_evidence`, которого в `deploy-production.yml` нет. Без этой задачи новые тесты из следующих задач никогда не выполнятся в CI.

**Files:**
- Modify: `infra/scripts/workflow.production.test.mjs`
- Modify: `.github/workflows/ci.yml` (job `static`, после шага «Run OpenAPI script unit tests»)

**Interfaces:**
- Produces: CI-шаг «Run infra script tests», который запускает `node --test infra/scripts/*.test.mjs` и каждый `infra/scripts/*.test.sh`.

- [ ] **Step 1: Убедиться в текущем падении**

Run: `node --test infra/scripts/workflow.production.test.mjs`
Expected: `ℹ fail 3` (тесты про `staging_evidence`).

- [ ] **Step 2: Убрать проверки несуществующего `staging_evidence`**

В `infra/scripts/workflow.production.test.mjs`:

```js
test('production workflow requires manual dispatch with required inputs', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /image_tag:/);
  assert.match(workflow, /migration_compatibility:/);
  assert.match(workflow, /backup_evidence:/);
  assert.match(workflow, /required:\s*true/);
});
```

```js
test('production workflow validates SHA format and evidence', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /grep -Eq '\^\[0-9a-f\]\{7,40\}\$'/);
  assert.match(workflow, /test -n.*backup_evidence/i);
});
```

```js
test('production workflow records all evidence in metadata', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /migration_compatibility=/);
  assert.match(workflow, /backup_evidence=/);
  assert.match(workflow, /environment=production/);
  assert.match(workflow, /retention-days: 90/);
});
```

(Поле `image_tag` здесь пока остаётся — его заменит Task 6.)

- [ ] **Step 3: Проверить, что оба набора зелёные**

Run: `node --test infra/scripts/*.test.mjs`
Expected: `ℹ fail 0`.

Run: `for f in infra/scripts/*.test.sh; do bash "$f" || echo "FAILED $f"; done`
Expected: каждый файл заканчивается `All assertions passed.`, строк `FAILED` нет.

- [ ] **Step 4: Добавить шаг в CI**

В `.github/workflows/ci.yml`, job `static`, сразу после шага `Run OpenAPI script unit tests`:

```yaml
      - name: Run infra script tests
        run: |
          node --test infra/scripts/*.test.mjs
          for test_file in infra/scripts/*.test.sh; do
            bash "$test_file"
          done
```

(`run:` в GitHub Actions выполняется с `bash -e`, поэтому первый упавший файл валит шаг.)

- [ ] **Step 5: Commit** (только с одобрения владельца)

```bash
git add .github/workflows/ci.yml infra/scripts/workflow.production.test.mjs
git commit -m "ci: запуск тестов infra-скриптов и актуальные проверки production workflow"
```

---

### Task 2: release-please — конфиг, версия в package.json, workflow `release.yml`

**Files:**
- Modify: `package.json` (корень)
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Modify: `.prettierignore`
- Create: `.github/workflows/release.yml`
- Create: `scripts/ci/release-config.test.mjs` (CI уже запускает `scripts/ci/*.test.mjs`)
- Modify: `infra/scripts/workflow.test.mjs`

**Interfaces:**
- Produces: корневой `package.json` с полем `version` — источник версии для Task 3 (`publish.yml`) и Task 4/5 (`release.sh`). Теги формата `vX.Y.Z`, создаваемые токеном GitHub App (поэтому они запускают `push`-триггеры других workflows).

- [ ] **Step 1: Написать падающий тест конфига**

`scripts/ci/release-config.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../..', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

async function appPackagePaths() {
  const entries = await readdir(new URL('apps/', root), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `apps/${entry.name}/package.json`)
    .sort();
}

test('release-please releases the whole product as one node package', async () => {
  const config = await readJson('release-please-config.json');

  assert.equal(config['release-type'], 'node');
  assert.equal(config['include-component-in-tag'], false);
  assert.deepEqual(Object.keys(config.packages), ['.']);
});

test('release-please syncs the version into every app package', async () => {
  const config = await readJson('release-please-config.json');
  const synced = config.packages['.']['extra-files']
    .filter((file) => file.type === 'json' && file.jsonpath === '$.version')
    .map((file) => file.path)
    .sort();

  assert.deepEqual(synced, await appPackagePaths());
});

test('root, manifest and app packages carry the same version', async () => {
  const rootPackage = await readJson('package.json');
  const manifest = await readJson('.release-please-manifest.json');

  assert.match(rootPackage.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest['.'], rootPackage.version);
  for (const path of await appPackagePaths()) {
    const appPackage = await readJson(path);
    assert.equal(appPackage.version, rootPackage.version, path);
  }
});

test('changelog sections are Russian and hide technical commit types', async () => {
  const config = await readJson('release-please-config.json');
  const sections = Object.fromEntries(
    config['changelog-sections'].map((section) => [section.type, section]),
  );

  assert.equal(sections.feat.section, 'Новое');
  assert.equal(sections.fix.section, 'Исправления');
  assert.equal(sections.perf.section, 'Производительность');
  assert.equal(sections.revert.section, 'Откаты');
  for (const type of ['docs', 'chore', 'test', 'style', 'refactor', 'ci', 'build']) {
    assert.equal(sections[type]?.hidden, true, type);
  }
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test scripts/ci/release-config.test.mjs`
Expected: FAIL — `ENOENT ... release-please-config.json`.

- [ ] **Step 3: Добавить версию в корневой `package.json`**

После `"private": true,`:

```json
  "version": "0.0.0",
```

(`apps/*/package.json` уже имеют `"version": "0.0.0"`.)

- [ ] **Step 4: Создать конфиг и манифест**

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "include-component-in-tag": false,
  "bootstrap-sha": "f48fb0629fbc8a041ed7d3138902b3c2f8021943",
  "pull-request-title-pattern": "chore: релиз ${version}",
  "changelog-sections": [
    { "type": "feat", "section": "Новое" },
    { "type": "fix", "section": "Исправления" },
    { "type": "perf", "section": "Производительность" },
    { "type": "revert", "section": "Откаты" },
    { "type": "docs", "section": "Документация", "hidden": true },
    { "type": "chore", "section": "Обслуживание", "hidden": true },
    { "type": "test", "section": "Тесты", "hidden": true },
    { "type": "style", "section": "Оформление", "hidden": true },
    { "type": "refactor", "section": "Рефакторинг", "hidden": true },
    { "type": "ci", "section": "CI", "hidden": true },
    { "type": "build", "section": "Сборка", "hidden": true }
  ],
  "packages": {
    ".": {
      "package-name": "harmofin",
      "changelog-path": "CHANGELOG.md",
      "release-as": "1.0.0",
      "extra-files": [
        { "type": "json", "path": "apps/api/package.json", "jsonpath": "$.version" },
        { "type": "json", "path": "apps/web/package.json", "jsonpath": "$.version" },
        { "type": "json", "path": "apps/worker/package.json", "jsonpath": "$.version" }
      ]
    }
  }
}
```

`bootstrap-sha` — HEAD `main` на момент планирования (`f48fb06`, merge PR #47). Если к началу реализации `main` ушёл вперёд, подставить актуальный `git rev-parse origin/main`.

`.release-please-manifest.json`:

```json
{
  ".": "0.0.0"
}
```

- [ ] **Step 5: Исключить генерируемые файлы из prettier**

В конец `.prettierignore`:

```text
CHANGELOG.md
.release-please-manifest.json
```

- [ ] **Step 6: Прогнать тест конфига**

Run: `node --test scripts/ci/release-config.test.mjs`
Expected: `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 7: Написать падающий тест workflow**

В конец `infra/scripts/workflow.test.mjs`:

```js
test('release workflow runs release-please on main with a GitHub App token', async () => {
  const workflow = await readWorkflow('release.yml');

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /actions\/create-github-app-token@[0-9a-f]{40}/);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}/);
  assert.match(workflow, /secrets\.RELEASE_APP_ID/);
  assert.match(workflow, /secrets\.RELEASE_APP_PRIVATE_KEY/);
  assert.match(workflow, /token:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.match(workflow, /config-file:\s*release-please-config\.json/);
  assert.match(workflow, /manifest-file:\s*\.release-please-manifest\.json/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN/);
});
```

Run: `node --test infra/scripts/workflow.test.mjs`
Expected: FAIL — `ENOENT ... release.yml`.

- [ ] **Step 8: Создать `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

# Every write (release PR, tag, GitHub Release) uses the GitHub App token, so
# the default token stays read-only and CI runs on the release pull request.
permissions:
  contents: read

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - name: Create release app token
        id: app-token
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          app-id: ${{ secrets.RELEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}

      - name: Update release pull request or publish release
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          token: ${{ steps.app-token.outputs.token }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 9: Прогнать тесты и форматирование**

Run: `node --test infra/scripts/workflow.test.mjs scripts/ci/release-config.test.mjs`
Expected: `ℹ fail 0`.

Run: `pnpm format:check`
Expected: без ошибок (при необходимости `pnpm exec prettier --write` для новых файлов).

- [ ] **Step 10: Commit** (только с одобрения владельца)

```bash
git add package.json release-please-config.json .release-please-manifest.json .prettierignore .github/workflows/release.yml scripts/ci/release-config.test.mjs infra/scripts/workflow.test.mjs
git commit -m "ci: release-please с единой версией продукта"
```

---

### Task 3: Shell-хелперы резолва релиза `infra/scripts/release.sh`

Общая логика для `tag-release-images.yml` (Task 5) и `deploy-production.yml` (Task 6). Выносится в скрипт, чтобы её можно было проверить настоящими тестами, а не регулярками по YAML.

**Files:**
- Create: `infra/scripts/release.sh`
- Create: `infra/scripts/release.test.sh`

**Interfaces:**
- Produces (все функции работают в текущем git-репозитории, только чтение):
  - `normalize_release_version <input>` → stdout `X.Y.Z` для `X.Y.Z`/`vX.Y.Z`; иначе exit 1 без вывода.
  - `package_version_at <commit>` → stdout `version` из `package.json` на этом коммите.
  - `release_tag_at <commit>` → stdout первый тег `vX.Y.Z`, указывающий на коммит, или пусто (exit 0).
  - `resolve_release <input>` → stdout `"<full_sha> <version>"`; `<version>` = `X.Y.Z` или `unreleased` для SHA без тега; exit 1 с сообщением в stderr для неизвестной версии, неизвестного SHA или неверного формата.
  - `resolve_tagged_commit <commit>` → stdout `"<tag> <version>"`, если на коммите есть тег; пусто, если тега нет; exit 1, если версия тега не совпадает с `package.json` коммита.

- [ ] **Step 1: Написать падающий тест**

`infra/scripts/release.test.sh`:

```bash
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `bash infra/scripts/release.test.sh`
Expected: ошибка `release.sh: No such file or directory`.

- [ ] **Step 3: Реализовать `infra/scripts/release.sh`**

```bash
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
```

- [ ] **Step 4: Прогнать тест**

Run: `bash infra/scripts/release.test.sh`
Expected: последняя строка `All assertions passed.`

- [ ] **Step 5: Commit** (только с одобрения владельца)

```bash
git add infra/scripts/release.sh infra/scripts/release.test.sh
git commit -m "feat(infra): резолв версии релиза в commit SHA"
```

---

### Task 4: Версия внутри образов

**Files:**
- Modify: `infra/docker/Dockerfile` (stage `runtime-base`)
- Modify: `infra/docker/docker-bake.hcl`
- Modify: `.github/workflows/publish.yml`
- Modify: `infra/scripts/workflow.test.mjs`

**Interfaces:**
- Consumes: корневой `package.json#version` (Task 2).
- Produces: во всех runtime-образах `ENV APP_VERSION` и `ENV NUXT_PUBLIC_APP_VERSION`; используются в Task 7 (API) и Task 9 (веб).

- [ ] **Step 1: Написать падающие тесты**

В конец `infra/scripts/workflow.test.mjs`:

```js
test('runtime images bake the application version', async () => {
  const dockerfile = await readFile(new URL('infra/docker/Dockerfile', root), 'utf8');
  const bake = await readFile(new URL('infra/docker/docker-bake.hcl', root), 'utf8');

  assert.match(dockerfile, /ARG APP_VERSION=0\.0\.0-dev/);
  assert.match(dockerfile, /APP_VERSION=\$APP_VERSION/);
  assert.match(dockerfile, /NUXT_PUBLIC_APP_VERSION=\$APP_VERSION/);
  assert.match(bake, /variable "APP_VERSION"/);
  assert.match(bake, /APP_VERSION\s*=\s*APP_VERSION/);
});

test('publish workflow passes the package version into images', async () => {
  const workflow = await readWorkflow('publish.yml');

  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /build-args:\s*\|\s*\n\s*APP_VERSION=\$\{\{ env\.APP_VERSION \}\}/);
  assert.match(workflow, /org\.opencontainers\.image\.version=\$\{\{ env\.APP_VERSION \}\}/);
  assert.match(workflow, /"version=\$\{APP_VERSION\}"/);
});
```

Run: `node --test infra/scripts/workflow.test.mjs`
Expected: FAIL в двух новых тестах.

- [ ] **Step 2: Dockerfile**

В stage `runtime-base` сразу после строки `USER app` (ниже установочных `RUN`, чтобы смена версии не инвалидировала их кэш):

```dockerfile

# Release version from the root package.json; the web reads it as
# runtimeConfig.public.appVersion, the API as config.appVersion.
ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION \
    NUXT_PUBLIC_APP_VERSION=$APP_VERSION
```

- [ ] **Step 3: docker-bake.hcl**

После блока `variable "TAG"`:

```hcl
variable "APP_VERSION" {
  default = "0.0.0-dev"
}
```

Блок `_common` заменить на:

```hcl
target "_common" {
  context    = "."
  dockerfile = "infra/docker/Dockerfile"
  args = {
    APP_VERSION = APP_VERSION
  }
}
```

- [ ] **Step 4: publish.yml**

Перед шагом `Log in to GitHub Container Registry`:

```yaml
      - name: Read release version
        run: |
          printf 'APP_VERSION=%s\n' "$(node -p "require('./package.json').version")" >> "$GITHUB_ENV"
```

В шаге `Build and publish immutable image` после `tags:` добавить `build-args` и расширить `labels`:

```yaml
          tags: ${{ env.IMAGE_REPOSITORY }}:${{ env.RELEASE_SHA }}
          build-args: |
            APP_VERSION=${{ env.APP_VERSION }}
          labels: |
            org.opencontainers.image.revision=${{ env.RELEASE_SHA }}
            org.opencontainers.image.version=${{ env.APP_VERSION }}
            org.opencontainers.image.source=https://github.com/${{ github.repository }}
```

В шаге `Publish release metadata` добавить строку версии:

```yaml
          printf '%s\n' \
            "image=${IMAGE_REPOSITORY}:${RELEASE_SHA}" \
            "revision=${RELEASE_SHA}" \
            "version=${APP_VERSION}" \
            "target=${{ matrix.target }}" > "release-${{ matrix.target }}-${RELEASE_SHA}.txt"
```

- [ ] **Step 5: Прогнать тесты**

Run: `node --test infra/scripts/*.test.mjs infra/docker/production-topology.test.mjs`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit** (только с одобрения владельца)

```bash
git add infra/docker/Dockerfile infra/docker/docker-bake.hcl .github/workflows/publish.yml infra/scripts/workflow.test.mjs
git commit -m "feat(infra): версия приложения в production-образах"
```

---

### Task 5: Workflow `tag-release-images.yml`

**Files:**
- Create: `.github/workflows/tag-release-images.yml`
- Create: `infra/scripts/workflow-test-helpers.mjs`
- Modify: `infra/scripts/workflow.test.mjs`

**Interfaces:**
- Consumes: `resolve_tagged_commit` из `infra/scripts/release.sh` (Task 3); SHA-образы `ghcr.io/<owner>/harmofin-<target>:<full_sha>` из `publish.yml`.
- Produces: теги `ghcr.io/<owner>/harmofin-<target>:X.Y.Z` для `web`, `api`, `worker`, `migrate`; хелпер `runBlocks(workflow: string): string[]` в `infra/scripts/workflow-test-helpers.mjs` (используется и в Task 6).

- [ ] **Step 1: Хелпер для проверки `run:`-блоков**

`infra/scripts/workflow-test-helpers.mjs` (имя без `.test.`, поэтому `node --test infra/scripts/*.test.mjs` не запускает его как тест):

```js
// Returns the script text of every `run:` step, so tests can assert what reaches
// the shell without matching unrelated `env:` blocks.
export function runBlocks(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:- )?run:(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const block = [match[2]];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      block.push(line);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}
```

К импортам в начале `infra/scripts/workflow.test.mjs`:

```js
import { runBlocks } from './workflow-test-helpers.mjs';
```

- [ ] **Step 2: Написать падающий тест**

В конец `infra/scripts/workflow.test.mjs`:

```js
test('release image tagging reacts to tags and to published images', async () => {
  const workflow = await readWorkflow('tag-release-images.yml');

  assert.match(workflow, /push:\s*\n\s*tags:\s*\['v\*\.\*\.\*'\]/);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows:\s*\[Publish images\]/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /source infra\/scripts\/release\.sh/);
  assert.match(workflow, /resolve_tagged_commit/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /docker buildx imagetools create --tag/);
  assert.match(workflow, /for target in web api worker migrate/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /packages:\s*write/);
  assert.doesNotMatch(workflow, /:latest/);
  assert.doesNotMatch(workflow, /pull_request/);
  for (const block of runBlocks(workflow)) {
    assert.doesNotMatch(block, /\$\{\{\s*github\.(event|ref_name)/);
  }
});
```

Run: `node --test infra/scripts/workflow.test.mjs`
Expected: FAIL — `ENOENT ... tag-release-images.yml`.

- [ ] **Step 3: Создать workflow**

`.github/workflows/tag-release-images.yml`:

```yaml
name: Tag release images

# release-please tags the release commit within seconds, while its images are
# published only after CI finishes, so either event may come first. Both
# triggers run the same idempotent job; whichever finds tag and images tags them.
on:
  push:
    tags: ['v*.*.*']
  workflow_run:
    workflows: [Publish images]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  packages: write

concurrency:
  group: tag-release-images
  cancel-in-progress: false

jobs:
  tag:
    if: ${{ github.event_name == 'push' || github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    env:
      REGISTRY: ghcr.io
    steps:
      - name: Check out repository with tags
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0

      - name: Resolve release commit
        id: resolve
        env:
          EVENT_NAME: ${{ github.event_name }}
          PUSHED_TAG: ${{ github.ref_name }}
          RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
        run: |
          source infra/scripts/release.sh
          if [[ "$EVENT_NAME" == "push" ]]; then
            sha="$(git rev-parse "${PUSHED_TAG}^{commit}")"
          else
            sha="$RUN_HEAD_SHA"
          fi
          resolved="$(resolve_tagged_commit "$sha")"
          if [[ -z "$resolved" ]]; then
            echo "Commit $sha carries no release tag; nothing to tag."
            exit 0
          fi
          printf 'sha=%s\nversion=%s\n' "$sha" "${resolved#* }" >> "$GITHUB_OUTPUT"

      - name: Log in to GitHub Container Registry
        if: steps.resolve.outputs.version != ''
        run: |
          printf '%s' '${{ secrets.GITHUB_TOKEN }}' | docker login "$REGISTRY" \
            --username '${{ github.actor }}' --password-stdin

      - name: Set up Docker Buildx
        if: steps.resolve.outputs.version != ''
        uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e # v4.3.0

      - name: Add release version tag to published images
        if: steps.resolve.outputs.version != ''
        env:
          OWNER: ${{ github.repository_owner }}
          RELEASE_SHA: ${{ steps.resolve.outputs.sha }}
          RELEASE_VERSION: ${{ steps.resolve.outputs.version }}
        run: |
          image_prefix="${REGISTRY}/${OWNER,,}/harmofin"
          for target in web api worker migrate; do
            if ! docker buildx imagetools inspect "${image_prefix}-${target}:${RELEASE_SHA}" >/dev/null 2>&1; then
              echo "Images for ${RELEASE_SHA} are not published yet; the Publish images run will tag them."
              exit 0
            fi
          done
          for target in web api worker migrate; do
            docker buildx imagetools create --tag "${image_prefix}-${target}:${RELEASE_VERSION}" \
              "${image_prefix}-${target}:${RELEASE_SHA}"
          done
          echo "Tagged ${RELEASE_SHA} as ${RELEASE_VERSION}."
```

- [ ] **Step 4: Прогнать тест**

Run: `node --test infra/scripts/workflow.test.mjs`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit** (только с одобрения владельца)

```bash
git add .github/workflows/tag-release-images.yml infra/scripts/workflow-test-helpers.mjs infra/scripts/workflow.test.mjs
git commit -m "ci: тег версии на опубликованных образах релиза"
```

---

### Task 6: Деплой production по версии

**Files:**
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `infra/scripts/workflow.production.test.mjs`

**Interfaces:**
- Consumes: `resolve_release` из `infra/scripts/release.sh` (Task 3).
- Produces: вход `release` (вместо `image_tag`); outputs job `validate`: `sha` (полный SHA), `version` (`X.Y.Z` или `unreleased`). `deploy.sh` получает `IMAGE_TAG=<full_sha>`, как и раньше.

- [ ] **Step 1: Обновить тесты под новый контракт**

В `infra/scripts/workflow.production.test.mjs` добавить импорт `import { runBlocks } from './workflow-test-helpers.mjs';` (создан в Task 5), заменить тест входов и тест валидации, добавить новые:

```js
test('production workflow requires manual dispatch with required inputs', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:/);
  assert.doesNotMatch(workflow, /image_tag:/);
  assert.match(workflow, /migration_compatibility:/);
  assert.match(workflow, /backup_evidence:/);
  assert.match(workflow, /required:\s*true/);
});

test('production workflow validates SHA format and evidence', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /grep -Eq '\^\[0-9a-f\]\{7,40\}\$'/);
  assert.match(workflow, /test -n.*BACKUP_EVIDENCE/);
});

test('production workflow resolves a release version to its tagged SHA', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /source infra\/scripts\/release\.sh/);
  assert.match(workflow, /resolve_release "\$RELEASE_INPUT"/);
  assert.match(workflow, /RELEASE_INPUT:\s*\$\{\{\s*inputs\.release\s*\}\}/);
  assert.match(workflow, /sha:\s*\$\{\{\s*steps\.resolve\.outputs\.sha\s*\}\}/);
  assert.match(workflow, /RELEASE_SHA:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
  assert.match(workflow, /ref:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
});

test('production workflow never interpolates inputs into shell scripts', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  for (const block of runBlocks(workflow)) {
    assert.doesNotMatch(block, /\$\{\{\s*inputs\./);
  }
});
```

И в тест метаданных добавить `version=`:

```js
test('production workflow records all evidence in metadata', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /version=%s/);
  assert.match(workflow, /migration_compatibility=/);
  assert.match(workflow, /backup_evidence=/);
  assert.match(workflow, /environment=production/);
  assert.match(workflow, /retention-days: 90/);
});
```

Тест «never interpolates inputs» проверяет каждый `run:`-блок отдельно: входы допустимы только в `env:`.

Run: `node --test infra/scripts/workflow.production.test.mjs`
Expected: FAIL в изменённых тестах.

- [ ] **Step 2: Переписать вход и job `validate`**

В `on.workflow_dispatch.inputs` заменить `image_tag` на:

```yaml
      release:
        description: 'Release version (1.2.3 or v1.2.3) or exact commit SHA to deploy'
        required: true
        type: string
```

Job `validate` целиком:

```yaml
  validate:
    runs-on: ubuntu-latest
    outputs:
      sha: ${{ steps.resolve.outputs.sha }}
      version: ${{ steps.resolve.outputs.version }}
    steps:
      - name: Check out repository with tags
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0

      - name: Resolve release to commit SHA
        id: resolve
        env:
          RELEASE_INPUT: ${{ inputs.release }}
        run: |
          source infra/scripts/release.sh
          resolved="$(resolve_release "$RELEASE_INPUT")"
          printf 'sha=%s\nversion=%s\n' "${resolved% *}" "${resolved#* }" >> "$GITHUB_OUTPUT"
          echo "Deploying ${resolved#* } (${resolved% *})."

      - name: Validate backup evidence
        env:
          BACKUP_EVIDENCE: ${{ inputs.backup_evidence }}
        run: |
          test -n "$BACKUP_EVIDENCE"
```

- [ ] **Step 3: Обновить job `deploy`**

В `env:` job `deploy`:

```yaml
      RELEASE_SHA: ${{ needs.validate.outputs.sha }}
      RELEASE_VERSION: ${{ needs.validate.outputs.version }}
```

(строку `RELEASE_SHA: ${{ inputs.image_tag }}` удалить; `MIGRATION_COMPATIBILITY` и `BACKUP_EVIDENCE` остаются.)

Шаг `Check out tested revision`:

```yaml
        with:
          ref: ${{ needs.validate.outputs.sha }}
```

Шаг `Publish production release metadata`:

```yaml
      - name: Publish production release metadata
        run: |
          printf 'environment=production\nrevision=%s\nversion=%s\nmigration_compatibility=%s\nbackup_evidence=%s\nresult=success\n' \
            "$RELEASE_SHA" "$RELEASE_VERSION" "$MIGRATION_COMPATIBILITY" "$BACKUP_EVIDENCE" \
            > production-release-${RELEASE_SHA}.txt
```

Шаг `Validate production inputs` с проверкой `grep -Eq '^[0-9a-f]{7,40}$'` по `$RELEASE_SHA` остаётся без изменений.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test infra/scripts/*.test.mjs`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit** (только с одобрения владельца)

```bash
git add .github/workflows/deploy-production.yml infra/scripts/workflow.production.test.mjs
git commit -m "feat(ci): деплой production по версии релиза"
```

---

### Task 7: Версия и ревизия в `/api/v1/health/live`

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `apps/api/src/health/health.dto.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.controller.test.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/health.integration.test.ts`
- Modify: фикстуры `ApiConfig` (`apps/api/src/common/security/security.guards.test.ts`, `apps/api/src/observability/app-observability.test.ts` и любые другие, на которые укажет typecheck)
- Regenerate: `openapi.json`

**Interfaces:**
- Consumes: `APP_VERSION` в окружении (Task 4); существующий `config.releaseSha` (`RELEASE_SHA`).
- Produces: `ApiConfig.appVersion: string`; `GET /api/v1/health/live` → `{ status: 'ok', version: string, revision: string }` (Task 8 читает `revision`).

- [ ] **Step 1: Написать падающие тесты**

`apps/api/src/config/env.test.ts`: в ожидаемый объект теста `maps valid test configuration with secure defaults` после `releaseSha: 'dev',` добавить:

```ts
      appVersion: '0.0.0-dev',
```

В тест `maps configured telemetry endpoints` добавить во вход `APP_VERSION: '1.2.3',`, а в ожидание `toMatchObject` — `appVersion: '1.2.3',`.

`apps/api/src/health/health.controller.test.ts` заменить целиком:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { ApiConfig } from '../config/env.js';
import type { DatabaseHealthService } from '../database/database-health.service.js';
import type { MetricsRegistry } from '../observability/observability.js';
import { HealthController } from './health.controller.js';

function fakeMetrics(): MetricsRegistry {
  return {
    setDatabaseReadiness: vi.fn(),
    recordDatabaseLatency: vi.fn(),
    increment: vi.fn(),
  } as unknown as MetricsRegistry;
}

const buildConfig = { appVersion: '1.2.3', releaseSha: 'abc1234' } as ApiConfig;

function controllerWith(database: Pick<DatabaseHealthService, 'check'>): HealthController {
  return new HealthController(
    database as unknown as DatabaseHealthService,
    fakeMetrics(),
    buildConfig,
  );
}

describe('HealthController', () => {
  it('reports a live process with its release version and revision', () => {
    const controller = controllerWith({ check: vi.fn() });

    expect(controller.live()).toEqual({ status: 'ok', version: '1.2.3', revision: 'abc1234' });
  });

  it('reports a ready database dependency', async () => {
    const controller = controllerWith({ check: vi.fn().mockResolvedValue(undefined) });

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ok' },
    });
  });

  it('translates database failures to a safe service unavailable error', async () => {
    const controller = controllerWith({
      check: vi.fn().mockRejectedValue(new Error('password=secret SELECT 1')),
    });

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
      },
    });
  });
});
```

`apps/api/test/health.integration.test.ts`: в `baseConfig` после `releaseSha: 'test',` добавить `appVersion: 'test-version',`; в тесте `publishes liveness`:

```ts
    expect(response.json()).toEqual({
      status: 'ok',
      version: baseConfig.appVersion,
      revision: baseConfig.releaseSha,
    });
```

и в тесте OpenAPI-документа рядом с проверкой путей добавить:

```ts
    expect(document.components.schemas.LiveHealthResponse?.required).toEqual(
      expect.arrayContaining(['status', 'version', 'revision']),
    );
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter @harmofin/api exec vitest run src/config/env.test.ts src/health/health.controller.test.ts`
Expected: FAIL (`appVersion` отсутствует, `live()` возвращает только `status`).

- [ ] **Step 3: Конфиг**

`apps/api/src/config/env.ts`:

- в `apiEnvironmentSchema` после `RELEASE_SHA`:

```ts
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
```

- в `interface ApiConfig` после `releaseSha: string;`:

```ts
  appVersion: string;
```

- в возвращаемом объекте `loadApiConfig` после `releaseSha: environment.RELEASE_SHA,`:

```ts
    appVersion: environment.APP_VERSION,
```

- [ ] **Step 4: DTO**

`apps/api/src/health/health.dto.ts`, класс `LiveHealthResponse`:

```ts
export class LiveHealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: '1.2.3' })
  version!: string;

  @ApiProperty({ example: '0123456789abcdef0123456789abcdef01234567' })
  revision!: string;
}
```

- [ ] **Step 5: Контроллер и модуль**

`apps/api/src/health/health.controller.ts`:

```ts
import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
```

Конструктор:

```ts
  constructor(
    @Inject(DatabaseHealthService)
    private readonly databaseHealth: DatabaseHealthService,
    @Inject(MetricsRegistry)
    private readonly metrics: MetricsRegistry,
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
  ) {}
```

`live()`:

```ts
  live(): LiveHealthResponse {
    return { status: 'ok', version: this.config.appVersion, revision: this.config.releaseSha };
  }
```

`apps/api/src/health/health.module.ts` заменить:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import { HealthController } from './health.controller.js';

@Module({})
export class HealthModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: API_CONFIG, useValue: config }],
    };
  }
}
```

`apps/api/src/app.module.ts`: в `imports` заменить `HealthModule,` на `HealthModule.register(config),`.

- [ ] **Step 6: Починить фикстуры `ApiConfig`**

Run: `pnpm --filter @harmofin/api typecheck`
Для каждого места с ошибкой «Property 'appVersion' is missing» добавить рядом с `releaseSha` строку `appVersion: 'test-version',` (как минимум `security.guards.test.ts` и `app-observability.test.ts`). Повторять, пока typecheck не станет чистым.

- [ ] **Step 7: Прогнать unit-тесты API**

Run: `pnpm --filter @harmofin/api test`
Expected: все PASS.

- [ ] **Step 8: Регенерировать OpenAPI и проверить совместимость**

Run: `node scripts/openapi/generate.mjs`
Expected: в `git diff openapi.json` только добавлены свойства `version`, `revision` (и `required`) в схеме `LiveHealthResponse`.

Run: `git show HEAD:openapi.json > openapi.base.json && node scripts/openapi/check.mjs openapi.json openapi.base.json; rm openapi.base.json`
Expected: без breaking changes.

- [ ] **Step 9: Интеграционный тест** (если локально подняты Postgres и Mailpit через `pnpm infra:up`; иначе его выполнит CI)

Run: `pnpm test:integration`
Expected: PASS, включая `health.integration.test.ts`.

- [ ] **Step 10: Commit** (только с одобрения владельца)

```bash
git add apps/api openapi.json
git commit -m "feat(api): версия и ревизия сборки в /health/live"
```

---

### Task 8: Smoke сверяет ревизию развёрнутого API

**Files:**
- Modify: `infra/scripts/smoke.sh`
- Modify: `infra/scripts/smoke.test.sh`
- Modify: `infra/scripts/deploy.sh` (`run_deploy_smoke`)
- Modify: `infra/scripts/deploy.test.sh`

**Interfaces:**
- Consumes: поле `revision` в `/api/v1/health/live` (Task 7).
- Produces: `check_api_revision <body_fn> <url> <expected_revision>`; `run_smoke_checks` проверяет ревизию, если задан `EXPECTED_REVISION`; `run_deploy_smoke` передаёт `EXPECTED_REVISION="$IMAGE_TAG"`.

Ответ без поля `revision` (откат на образ, собранный до этой задачи) не валит smoke: печатается предупреждение и проверка пропускается. Несовпадение — ошибка.

- [ ] **Step 1: Написать падающие тесты smoke**

В `infra/scripts/smoke.test.sh` перед `report_results`:

```bash
# check_api_revision: compares the deployed revision with the expected SHA
fake_body_with_revision() {
  echo '{"status":"ok","version":"1.2.3","revision":"abc1234"}'
}
assert_success "check_api_revision succeeds when the revision matches" \
  check_api_revision fake_body_with_revision "http://example.invalid/api/v1/health/live" abc1234
assert_failure "check_api_revision fails when another revision is running" \
  check_api_revision fake_body_with_revision "http://example.invalid/api/v1/health/live" def5678

output="$(check_api_revision fake_body_with_revision "http://example.invalid/api/v1/health/live" def5678 2>&1 || true)"
case "$output" in
  *"Expected revision def5678"*"got abc1234"*) echo "ok - check_api_revision names both revisions" ;;
  *)
    echo "not ok - check_api_revision names both revisions (got: $output)"
    failures=$((failures + 1))
    ;;
esac

fake_body_without_revision() {
  echo '{"status":"ok"}'
}
assert_success "check_api_revision tolerates releases that predate revision reporting" \
  check_api_revision fake_body_without_revision "http://example.invalid/api/v1/health/live" abc1234
```

Run: `bash infra/scripts/smoke.test.sh`
Expected: `not ok` для новых проверок (`check_api_revision: command not found`), exit 1.

- [ ] **Step 2: Реализовать в `smoke.sh`**

После функции `curl_status`:

```bash
# curl_body <url>
# Real body fetcher used by production callers of check_api_revision.
curl_body() {
  local url="$1"
  curl -s --max-time 5 "$url"
}

# check_api_revision <body_fn> <url> <expected_revision>
# Reads the API liveness body and compares its "revision" with the deployed
# SHA. Releases built before revision reporting omit the field; they pass with
# a warning so rollbacks to them still work.
check_api_revision() {
  local body_fn="$1"
  local url="$2"
  local expected_revision="$3"
  local actual_revision

  actual_revision="$("$body_fn" "$url" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')"

  if [[ -z "$actual_revision" ]]; then
    echo "Warning: $url does not report a revision; skipping revision check." >&2
    return 0
  fi

  if [[ "$actual_revision" != "$expected_revision" ]]; then
    echo "Expected revision $expected_revision from $url, got $actual_revision." >&2
    return 1
  fi

  return 0
}
```

В `run_smoke_checks` после проверки API liveness:

```bash
  if [[ -n "${EXPECTED_REVISION:-}" ]]; then
    echo "Checking API revision at $base_url/api/v1/health/live"
    check_api_revision curl_body "$base_url/api/v1/health/live" "$EXPECTED_REVISION" || return 1
  fi
```

Run: `bash infra/scripts/smoke.test.sh`
Expected: `All assertions passed.`

- [ ] **Step 3: Написать падающий тест deploy**

В конец `infra/scripts/deploy.test.sh` перед `report_results` (переопределение `run_smoke_checks` действует только на этот последний блок):

```bash
# run_deploy_smoke: smoke expects the revision that was just deployed
captured_expected_revision=""
run_smoke_checks() {
  captured_expected_revision="${EXPECTED_REVISION:-}"
}
IMAGE_TAG=abc1234 SMOKE_BASE_URL=http://example.invalid run_deploy_smoke
assert_equal "run_deploy_smoke expects the deployed revision" "abc1234" "$captured_expected_revision"
```

Run: `bash infra/scripts/deploy.test.sh`
Expected: `not ok - run_deploy_smoke expects the deployed revision (expected "abc1234", got "")`.

- [ ] **Step 4: Передать ревизию в `deploy.sh`**

`run_deploy_smoke`:

```bash
run_deploy_smoke() {
  local base_url="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
  EXPECTED_REVISION="${IMAGE_TAG:-}" run_smoke_checks "$base_url"
}
```

(Compose передаёт API `RELEASE_SHA=${IMAGE_TAG}`, поэтому ожидаемая ревизия — тот же `IMAGE_TAG`; при rollback `IMAGE_TAG` уже переключён на выбранный SHA.)

- [ ] **Step 5: Прогнать все shell-тесты**

Run: `for f in infra/scripts/*.test.sh; do bash "$f" || echo "FAILED $f"; done`
Expected: все `All assertions passed.`, строк `FAILED` нет.

- [ ] **Step 6: Commit** (только с одобрения владельца)

```bash
git add infra/scripts/smoke.sh infra/scripts/smoke.test.sh infra/scripts/deploy.sh infra/scripts/deploy.test.sh
git commit -m "feat(infra): smoke сверяет ревизию развёрнутого API"
```

---

### Task 9: Строка «Версия X.Y.Z» в настройках веба

Перед правкой прочитать [Calm Fintech visual guidelines](../specs/2026-09-17-calm-fintech-visual-guidelines.md): вторичный текст, без карточки и иконки.

**Files:**
- Modify: `apps/web/nuxt.config.ts`
- Modify: `apps/web/app/test/nuxt-imports.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue`
- Modify: `apps/web/app/pages/app/settings/index.test.ts`

**Interfaces:**
- Consumes: `NUXT_PUBLIC_APP_VERSION` в окружении образа (Task 4).
- Produces: `runtimeConfig.public.appVersion: string`.

- [ ] **Step 1: Stub для тестов**

В `apps/web/app/test/nuxt-imports.ts` добавить:

```ts
export function useRuntimeConfig(): { public: { appVersion: string } } {
  return { public: { appVersion: '0.0.0-test' } };
}
```

- [ ] **Step 2: Написать падающий тест**

В `describe('settings hub page', ...)` файла `apps/web/app/pages/app/settings/index.test.ts`:

```ts
  it('shows the running application version as secondary text', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.settings-page__version').text()).toBe('Версия 0.0.0-test');
  });
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/index.test.ts`
Expected: FAIL — элемент `.settings-page__version` не найден.

- [ ] **Step 3: runtimeConfig**

`apps/web/nuxt.config.ts`, в `runtimeConfig.public` после `apiUrl: config.apiUrl,`:

```ts
      // Filled at runtime from NUXT_PUBLIC_APP_VERSION, baked into the image at build.
      appVersion: '0.0.0-dev',
```

- [ ] **Step 4: Страница настроек**

`apps/web/app/pages/app/settings/index.vue`:

- импорт: `import { definePageMeta, useRuntimeConfig } from '#imports';`
- после `const { currentData, loadMe } = useAuth();`:

```ts
// Nuxt parses NUXT_PUBLIC_* values, so the version is normalized to text.
const appVersion = String(useRuntimeConfig().public.appVersion).trim();
```

- в шаблоне, внутри `<template #content>` сразу после закрывающего `</div>` блока `settings-page__grid`:

```html
      <p v-if="appVersion" class="settings-page__version">Версия {{ appVersion }}</p>
```

- в `<style scoped>` после `.settings-page__help-link`:

```css
.settings-page__version {
  margin: var(--hf-space-5) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
```

- [ ] **Step 5: Прогнать тесты и typecheck веба**

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/index.test.ts`
Expected: PASS.

Run: `pnpm --filter @harmofin/web typecheck`
Expected: без ошибок.

- [ ] **Step 6: Commit** (только с одобрения владельца)

```bash
git add apps/web/nuxt.config.ts apps/web/app/test/nuxt-imports.ts apps/web/app/pages/app/settings/index.vue apps/web/app/pages/app/settings/index.test.ts
git commit -m "feat(web): версия приложения на странице настроек"
```

---

### Task 10: Документация релизного процесса

**Files:**
- Create: `docs/runbooks/release.md`
- Modify: `docs/runbooks/deploy.md` (раздел «4. Запустить production workflow»)
- Modify: `README.md` (новый раздел «Релизы» перед «Документация»)
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md` (конец §14.1)

- [ ] **Step 1: Runbook `docs/runbooks/release.md`**

````markdown
# Выпуск релиза

HarmoFin использует единую версию SemVer `vX.Y.Z` для web, API, worker и migrate.
Дизайн: [версионирование и выпуск релизов](../superpowers/specs/2026-10-19-release-versioning-design.md).

## Разовая настройка

1. Создать GitHub App (Settings → Developer settings → GitHub Apps) с правами репозитория:
   Contents — Read and write, Pull requests — Read and write, Metadata — Read-only. Webhook не нужен.
2. Установить App только на репозиторий HarmoFin.
3. Сохранить секреты репозитория: `RELEASE_APP_ID` (App ID) и `RELEASE_APP_PRIVATE_KEY` (содержимое private key `.pem`).
4. Убедиться, что branch protection `main` разрешает мерж PR от этого App после прохождения required checks.

## Как появляется релиз

1. Коммиты в `main` в формате Conventional Commits: `feat:` → minor, `fix:`/`perf:` → patch,
   `!` после типа или `BREAKING CHANGE:` → major. Остальные типы в changelog не попадают.
2. Workflow `Release` поддерживает открытый PR «chore: релиз X.Y.Z» с `CHANGELOG.md` и версией во всех `package.json`.
3. Мерж Release PR создаёт тег `vX.Y.Z` и GitHub Release.
4. После CI `Publish images` публикует образы по SHA; `Tag release images` добавляет им тег `X.Y.Z`.
5. Staging обновляется автоматически, как для любого коммита в `main`.

## Деплой версии в production

1. Проверить релиз на staging: `curl -s https://<staging>/api/v1/health/live` возвращает нужные `version` и `revision`.
2. Выполнить предусловия из [регламента деплоя](deploy.md) (backup, классификация миграций).
3. Запустить workflow `Deploy production` с `release=X.Y.Z`.
4. Smoke после деплоя сверяет `revision` из health с развёрнутым SHA.

## Откат

Запустить `Deploy production` с предыдущей версией (`release=X.Y.Z-1`) или по [регламенту отката образа](image-rollback.md).

## Первый релиз

Первый Release PR выпускает `1.0.0` (`release-as` в `release-please-config.json`). После выпуска `v1.0.0`
удалить `release-as` отдельным коммитом, иначе следующие Release PR снова будут предлагать `1.0.0`.
````

- [ ] **Step 2: Обновить `docs/runbooks/deploy.md`**

В разделе «4. Запустить production workflow» строку

```markdown
- `image_tag`: `[точный commit SHA]`
```

заменить на

```markdown
- `release`: версия релиза (`1.2.3` или `v1.2.3`) либо точный commit SHA; версия резолвится в SHA своего тега (см. [выпуск релиза](release.md))
```

- [ ] **Step 3: README**

Перед `## Документация`:

```markdown
## Релизы

Версия продукта — единый SemVer `vX.Y.Z` в корневом `package.json`. Release PR с changelog готовит
release-please по Conventional Commits; мерж Release PR ставит тег и GitHub Release, образы получают
тег версии, production деплоится workflow `Deploy production` с указанием версии.
Процедура и разовая настройка — в [runbook выпуска релиза](docs/runbooks/release.md).
```

- [ ] **Step 4: Development spec**

В конце §14.1 (после списка «CI/CD с автоматическим deploy staging и ручным deploy production.») добавить:

```markdown

Версионирование и выпуск релизов описаны в [отдельном дизайне](2026-10-19-release-versioning-design.md).
```

- [ ] **Step 5: Проверить форматирование**

Run: `pnpm format:check`
Expected: без ошибок.

- [ ] **Step 6: Commit** (только с одобрения владельца)

```bash
git add README.md docs/runbooks/release.md docs/runbooks/deploy.md docs/superpowers/specs/2026-08-30-family-budget-development-spec.md
git commit -m "docs: регламент выпуска релизов"
```

---

### Task 11: Финальная проверка

- [ ] **Step 1: Полный набор проверок**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
node --test infra/scripts/*.test.mjs scripts/ci/*.test.mjs infra/docker/production-topology.test.mjs
for f in infra/scripts/*.test.sh; do bash "$f" || echo "FAILED $f"; done
docker compose --env-file infra/env/staging.example -f infra/compose/production.yml config --quiet
```

Expected: всё зелёное; строк `FAILED` нет. `pnpm test:integration` — если подняты Postgres/Mailpit; e2e — только в CI.

- [ ] **Step 2: Просмотреть итоговый diff**

Run: `git diff main --stat` и `git diff main`
Проверить: нет `:latest`, нет `${{ inputs.` / `${{ github.event` внутри `run:`, все actions закреплены по SHA, `identity/logo_description.png` не тронут.

- [ ] **Step 3: Ревью**

По routing matrix: QA, final review, security review (CI/release, публичная версия/SHA в health), API review (`LiveHealthResponse`), UI/UX review (строка версии), backend review не требуется (миграций нет).

## После мержа (действия владельца)

1. Создать GitHub App и секреты (runbook, «Разовая настройка»).
2. Дождаться Release PR `chore: релиз 1.0.0`, смержить.
3. Проверить тег `v1.0.0`, GitHub Release и тег `1.0.0` у образов в GHCR.
4. Отдельным PR удалить `"release-as": "1.0.0"` из `release-please-config.json`.
