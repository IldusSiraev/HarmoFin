# Версионирование и выпуск релизов — дизайн

**Статус:** дизайн согласован владельцем 19.10.2026, ожидает ревью спеки.
**Область:** CI/CD (`.github/workflows/`), образы (`infra/docker/`), deploy-скрипты (`infra/scripts/`), API `/health/live`, строка версии в `apps/web`. Бизнес-правила, финансовый домен и схема БД не меняются.
**Вне scope:** страница «Что нового» для пользователей (отдельный подпроект с собственными пользовательскими заметками), commitlint/проверка заголовков PR, интеграция с Sentry.

## Текущее состояние

- Все `package.json` имеют `version: 0.0.0`, git-тегов и `CHANGELOG.md` нет.
- `publish.yml` после успешного CI на `main` публикует образы `web`, `api`, `worker`, `migrate` в GHCR с тегом полного SHA.
- `deploy-staging.yml` автоматически деплоит каждый опубликованный SHA.
- `deploy-production.yml` запускается вручную (`workflow_dispatch`) с точным SHA, подтверждением совместимости миграций и ссылкой на backup.
- Production compose передаёт `IMAGE_TAG` в образы и `RELEASE_SHA` в окружение `api`/`worker`.
- Коммиты уже следуют Conventional Commits (`feat(web): …`, `fix: …`) с описаниями на русском.
- Development spec §15.3 требует release/version в отчётах об ошибках — сейчас версии нет.

## Решения

| Вопрос | Решение |
|---|---|
| Схема версий | Единый SemVer `vX.Y.Z` на весь продукт (web, api, worker, migrate выпускаются вместе). |
| Рождение релиза | Release PR через `release-please`: владелец решает момент выпуска, мержа PR. |
| Авторизация release-please | GitHub App, токены через `actions/create-github-app-token`, чтобы на Release PR запускался CI. |
| Связь с деплоем | Production-деплой принимает версию; версия резолвится в SHA; образы получают дополнительный тег версии без пересборки. |
| Видимость версии | API `/health/live`, строка в настройках веба. |
| Первый релиз | `v1.0.0` (v1 уже в production). |

Рассмотренные альтернативы: Changesets (файл изменений в каждом PR — лишняя церемония для одного продукта, ориентирован на публикацию npm-пакетов), собственный скрипт на git-cliff (больше кода в поддержке), semantic-release (релиз на каждый мерж, нет контроля момента).

## 1. Версия и Release PR

### Конфигурация

- `release-please-config.json` в корне, манифест-режим, один пакет `"."` с `release-type: node`.
- `.release-please-manifest.json` хранит текущую версию корня.
- Источник истины версии — корневой `package.json`. Через `extra-files` (тип `json`, `jsonpath: $.version`) release-please синхронизирует `version` в `apps/api/package.json`, `apps/web/package.json`, `apps/worker/package.json`. Пакеты `packages/*` не версионируются (внутренние, не публикуются).
- `include-component-in-tag: false` — теги вида `v1.2.3`.
- `changelog-sections` на русском:
  - `feat` → «Новое»;
  - `fix` → «Исправления»;
  - `perf` → «Производительность»;
  - `revert` → «Откаты»;
  - `docs`, `chore`, `test`, `style`, `refactor`, `ci`, `build` — скрыты.
- Major-версия: `!` после типа или футер `BREAKING CHANGE:`. Коммиты, не соответствующие Conventional Commits, release-please игнорирует; это допустимо и не блокирует релиз.
- Заголовок Release PR: `chore: релиз ${version}`.

### Первый релиз

- `bootstrap-sha` = SHA `main` на момент внедрения, чтобы changelog `1.0.0` не включал всю историю проекта.
- `release-as: "1.0.0"` в конфиге для первого Release PR; после выпуска `v1.0.0` отдельным коммитом удаляется.
- Манифест стартует с `"."`: `"0.0.0"`.

### Workflow `release.yml`

- Триггер: `push` в `main`.
- `concurrency: release`, без отмены.
- `permissions: contents: read` для `GITHUB_TOKEN`; все записи (PR, тег, GitHub Release) делаются токеном App.
- Шаги:
  1. `actions/create-github-app-token` с `RELEASE_APP_ID` и `RELEASE_APP_PRIVATE_KEY`, scope — текущий репозиторий.
  2. `googleapis/release-please-action` с этим токеном и путями к конфигу/манифесту.
- Все actions закреплены по commit SHA с комментарием версии, как в существующих workflows.
- Права GitHub App (минимальные): Contents read/write, Pull requests read/write, Metadata read. App создаёт и устанавливает владелец; секреты кладутся в репозиторий владельцем.

### Поток

```text
feat/fix PR ──merge──▶ main ──▶ release.yml обновляет Release PR «chore: релиз 1.3.0»
                                 (CHANGELOG.md + version во всех package.json)
владелец мержит Release PR ──▶ main ──▶ release.yml создаёт тег v1.3.0 + GitHub Release
                                    └─▶ CI ─▶ publish.yml (образы :<sha>, внутри APP_VERSION=1.3.0)
                                                 └─▶ tag-release-images.yml добавляет :1.3.0
                                                 └─▶ deploy-staging.yml (как сейчас)
владелец запускает Deploy production с release=1.3.0
```

## 2. Образы и деплой

### Версия внутри образа

Коммит мержа Release PR сам поднимает `version` в `package.json`, поэтому образ, собранный из этого коммита, уже содержит правильную версию. Образы промежуточных коммитов несут последнюю выпущенную версию и отличаются ревизией.

- `infra/docker/Dockerfile`: в `runtime-base` добавить `ARG APP_VERSION=0.0.0-dev`, выставить `ENV APP_VERSION` и `ENV NUXT_PUBLIC_APP_VERSION`. Ревизия в образ не запекается: compose уже передаёт `RELEASE_SHA=${IMAGE_TAG}` в `api`/`worker`, а API хранит его в `config.releaseSha`.
- `publish.yml`: шаг читает `version` из корневого `package.json` (`node -p`), передаёт `build-args` `APP_VERSION`; добавляет OCI-label `org.opencontainers.image.version`.
- `docker-bake.hcl`: переменная `APP_VERSION` с локальным значением по умолчанию `0.0.0-dev`, чтобы локальная сборка оставалась рабочей.
- Существующая переменная `RELEASE_SHA` в compose не меняется.

### Workflow `tag-release-images.yml`

Задача: добавить образам тег версии, когда одновременно существуют git-тег `vX.Y.Z` и опубликованные SHA-образы. Порядок появления тега и образов не гарантирован (release-please отрабатывает быстрее CI), поэтому workflow запускается на оба события и идемпотентен.

- Триггеры: `push` тегов `v*.*.*`; `workflow_run` «Publish images» c `conclusion == success` на `main`; `workflow_dispatch` с необязательным входом `tag` (конкретный релиз для ручного дотегивания).
- `workflow_run.head_sha` не читается: для него непредсказуемо, какой коммит main триггернул завершившийся прогон Publish, и это может быть более новый коммит, чем коммит релиза.
- Кандидаты на тегирование (список git-тегов `vX.Y.Z`, а не одна пара):
  - `push` → только запушенный тег;
  - `workflow_dispatch` со входом `tag` → только этот тег;
  - иначе (`workflow_run`, либо `workflow_dispatch` без `tag`) → 5 новейших тегов: `git tag --list 'v*.*.*' --sort=-v:refname | head -n 5`.
- Для каждого кандидата: SHA = `git rev-parse "$TAG^{commit}"`; `resolve_tagged_commit "$SHA"` из `infra/scripts/release.sh` валидирует совпадение тега и версии в `package.json` на этом SHA (ошибка — весь job падает).
- Для каждого target (`web`, `api`, `worker`, `migrate`) у кандидата: если хотя бы один `ghcr.io/<owner>/harmofin-<target>:<sha>` отсутствует — лог «образы ещё не опубликованы» и переход к следующему кандидату без ошибки; если все четыре опубликованы — `docker buildx imagetools create --tag …:<X.Y.Z> …:<sha>` для всех четырёх. Повторное тегирование уже помеченного релиза идемпотентно.
- Тег `latest` не создаётся: деплой остаётся по неизменяемым ссылкам.
- `permissions: contents: read, packages: write`.

### `deploy-production.yml`

- Вход `image_tag` заменяется на `release`: «Версия (`1.2.3` / `v1.2.3`) или точный commit SHA».
- Новый шаг `resolve` в job `validate` с выходами `sha` и `version`:
  - `^v?[0-9]+\.[0-9]+\.[0-9]+$` → checkout с тегами, `sha = git rev-parse "v$X.$Y.$Z^{commit}"`; тега нет — ошибка «Релиз vX.Y.Z не найден»;
  - `^[0-9a-f]{7,40}$` → `sha` как есть, `version` = тег на этом SHA, иначе `unreleased`;
  - иначе ошибка формата.
- Job `deploy` использует `needs.validate.outputs.sha` как `RELEASE_SHA`/`IMAGE_TAG`. `deploy.sh`, rollback и compose не меняются: production по-прежнему разворачивает неизменяемый SHA-образ.
- Метаданные `production-release-<sha>.txt` получают поле `version=`.
- Подтверждение совместимости миграций и backup evidence сохраняются без изменений.

`deploy-staging.yml` не меняется.

## 3. Видимость версии

### API

- `LiveHealthResponse` расширяется полями `version: string` (пример `1.2.3`) и `revision: string` (пример — SHA). Изменение аддитивное, `/api/v1` совместим.
- `version` читается из `APP_VERSION` через существующий слой конфигурации API (`config.appVersion`, по умолчанию `0.0.0-dev`); `revision` — существующий `config.releaseSha` (`RELEASE_SHA`, по умолчанию `dev`).
- `/health/ready` не меняется.
- Раскрытие версии и SHA публично через health — осознанное решение для v1 (открытая информация о сборке, без секретов); отмечается для security-ревью.

### Smoke-проверка

- `smoke.sh`: новая функция `check_api_revision <curl_body_fn> <url> <expected_revision>` читает тело `/api/v1/health/live` и сравнивает поле `revision` с ожидаемым SHA. Разбор JSON без новых зависимостей на хосте: `grep -o '"revision":"[^"]*"'` + `sed` (ответ — плоский JSON, генерируемый нашим же контроллером).
- `run_smoke_checks` вызывает её, когда задан `EXPECTED_REVISION`; `deploy.sh` передаёт `EXPECTED_REVISION=$IMAGE_TAG`.
- Несовпадение — ошибка smoke с сообщением «Ожидалась ревизия X, получена Y», что запускает существующий путь отката.

### Веб

- `nuxt.config.ts`: `runtimeConfig.public.appVersion: '0.0.0-dev'`, заполняется из `NUXT_PUBLIC_APP_VERSION`.
- Страница `/app/settings` (индекс): внизу вторичным текстом «Версия 1.2.3» по правилам Calm Fintech (muted-цвет, без карточки, без иконки). Ревизия в UI не показывается.
- Версия — справочная информация, не источник истины для чего-либо.

## 4. Тесты

- `infra/scripts/workflow.test.mjs` / `workflow.production.test.mjs`:
  - `release.yml`: триггер, закреплённые actions, токен App, минимальные permissions;
  - `tag-release-images.yml`: оба триггера, валидация тега, отсутствие `latest`, идемпотентность через `imagetools create`;
  - `publish.yml`: build-args версии/ревизии;
  - `deploy-production.yml`: вход `release`, резолв версии/SHA, ошибка при неизвестном теге, `version` в метаданных.
- `smoke.test.sh`: совпадение ревизии, несовпадение, пропуск без `EXPECTED_REVISION`.
- `release-please-config.json`: тест на синхронизацию `extra-files` со всеми `apps/*/package.json` и на русские секции.
- API: unit-тест `HealthController.live` (version/revision, значения по умолчанию), OpenAPI-снимок/проверка схемы.
- Веб: тест страницы настроек на строку «Версия …».
- Тесты `infra/scripts/*.test.mjs` и `infra/scripts/*.test.sh` сейчас в CI не запускаются, а `workflow.production.test.mjs` устарел (ждёт несуществующий `staging_evidence`). В рамках работы устаревшие проверки приводятся к фактическому workflow, и оба набора подключаются в job `static` CI.
- Playwright локально не запускается; при необходимости сценарий добавляется для CI.

## 5. Документация

- `README.md`: раздел «Релизы» — схема версий, как устроен Release PR, как задеплоить версию.
- Runbook (в существующем месте операционной документации): разовая настройка GitHub App и секретов `RELEASE_APP_ID`/`RELEASE_APP_PRIVATE_KEY`; процедура выпуска: смержить Release PR → дождаться CI/образов и тега `X.Y.Z` в GHCR → проверить staging → `Deploy production` с `release=X.Y.Z`; откат на предыдущую версию тем же workflow.
- Development spec: в разделе деплоя ссылка на этот документ.

## Действия владельца

1. Создать GitHub App с правами из раздела 1, установить на репозиторий, сохранить секреты.
2. Проверить, что branch protection `main` допускает мерж Release PR (required checks запускаются от токена App).
3. Смержить первый Release PR `v1.0.0`, затем PR с удалением `release-as`.

## Критерии готовности

- Мерж feat/fix в `main` создаёт или обновляет Release PR с русским changelog и синхронной версией во всех `apps/*/package.json`.
- Мерж Release PR создаёт тег `vX.Y.Z` и GitHub Release; образы всех четырёх targets получают тег `X.Y.Z` независимо от порядка событий.
- `Deploy production` с `release=X.Y.Z` разворачивает SHA этого тега; неизвестная версия отклоняется до деплоя.
- `/api/v1/health/live` возвращает `version` и `revision`; smoke проваливается при несовпадении ревизии.
- В настройках веба видна строка «Версия X.Y.Z».
- Существующие проверки (`pnpm lint`, `pnpm typecheck`, `pnpm test`, shell- и workflow-тесты) проходят.
