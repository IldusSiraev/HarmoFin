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

Если образы релиза не получили тег версии (например, `Tag release images` запустился раньше, чем `Publish images` их опубликовал), запустить workflow `Tag release images` вручную с `tag=vX.Y.Z`.

## Деплой версии в production

1. Проверить релиз на staging: `curl -s https://<staging>/api/v1/health/live` возвращает нужные `version` и `revision`.
2. Выполнить предусловия из [регламента деплоя](deploy.md) (backup, классификация миграций).
3. Запустить workflow `Deploy production` с `release=X.Y.Z`.
4. Smoke после деплоя сверяет `revision` из health с развёрнутым SHA.

## Откат

Запустить `Deploy production` с предыдущей версией, например `release=1.2.2`, или по [регламенту отката образа](image-rollback.md).

## Первый релиз

Первый Release PR выпускает `1.0.0` (`release-as` в `release-please-config.json`). После выпуска `v1.0.0`
удалить `release-as` отдельным коммитом, иначе следующие Release PR снова будут предлагать `1.0.0`.
