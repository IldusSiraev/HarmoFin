# Регламент первичной настройки production-сервера

**Триггер**: разворачивается новый production-сервер HarmoFin с нуля (первый деплой на облачный VPS без managed-инфраструктуры)

**Контекст**: этот регламент описывает конкретный путь для self-hosted одиночного VPS (например, Timeweb Cloud) без managed PostgreSQL — Postgres поднимается как ещё один Docker-контейнер на том же сервере. Для steady-state повторных деплоев на уже настроенный сервер используйте `docs/runbooks/deploy.md`.

**Предусловия**:

- Домен куплен и NS указывают на DNS-провайдера, где будешь ставить A-запись
- Аккаунт в облачном провайдере (VPS с публичным IP, портами 22/80/443)
- Доступ на запись в GitHub-репозиторий (Settings → Environments)
- Локально сгенерирован SSH-ключ для деплоя

**Ориентировочная длительность**: 1-3 часа, в основном из-за ожидания репликации DNS

---

## 1. Сервер: создание и cloud-init

Создать VPS (Ubuntu). При создании — если панель провайдера это позволяет — вставить содержимое [infra/cloud-init/production.yaml](../../infra/cloud-init/production.yaml) в поле «Cloud-init» / «Пользовательские данные» **до первого запуска**. Cloud-init создаёт пользователя `deploy` (без пароля, только по SSH-ключу), ставит Docker + Compose plugin, создаёт директорию приложения, настраивает firewall (только 22/80/443).

Перед вставкой заменить `REPLACE_WITH_DEPLOY_PUBLIC_KEY` на реальный публичный ключ:

```bash
ssh-keygen -t ed25519 -f ./harmofin_deploy_key -C "harmofin-deploy" -N ""
```

Приватный файл (`harmofin_deploy_key`, без `.pub`) остаётся только локально — пойдёт в GitHub Secret на шаге 4. Публичный (`harmofin_deploy_key.pub`) — в cloud-init.

### Нюанс: если сервер уже создан

Панели типа Timeweb Cloud позволяют обновить cloud-init постфактум через раздел «Cloud-init» на странице сервера, но **изменения применяются только после перезагрузки сервера** — простого «Сохранить» недостаточно. После правки cloud-init — обязательно перезагрузить сервер, иначе новые ключи/пользователь не появятся.

- [ ] Cloud-init вставлен (при создании или через панель)
- [ ] Сервер перезагружен, если cloud-init обновлялся постфактум
- [ ] SSH-порт (22), HTTP (80), HTTPS (443) открыты в firewall провайдера

---

## 2. Проверка SSH-доступа

```bash
ssh -v -i C:\путь\до\harmofin_deploy_key deploy@<IP-сервера>
```

**Важно**: используй `-v` при первой попытке и **обязательно указывай `-i` явно** — если в `~/.ssh/` уже лежат другие ключи (например, личный `id_rsa`), автоподбор ключа может привести к запросу пароля вместо использования нужного ключа, хотя формально всё настроено верно.

Если после перезагрузки сервер всё ещё просит пароль — зайти через веб-консоль провайдера (VNC/serial console) под `root` и проверить:

```bash
cat /home/deploy/.ssh/authorized_keys   # ключ должен быть тут
id deploy                                # проверить группы: deploy, docker
cloud-init status --long                 # status: done, errors: []
ls -ld /home/deploy /home/deploy/.ssh /home/deploy/.ssh/authorized_keys  # права доступа
grep -Ei "PasswordAuthentication|PubkeyAuthentication" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf
```

- [ ] SSH-вход по ключу работает без пароля

---

## 3. Известный host key для GitHub Secret

```bash
ssh-keyscan -p 22 <IP-сервера>
```

Весь вывод (обычно 3 строки — ed25519/rsa/ecdsa) целиком идёт в секрет `PRODUCTION_KNOWN_HOSTS`.

---

## 4. GitHub: Environment `production`

Settings репозитория → Environments → создать `production`. Все ниже перечисленные значения добавлять именно через **«Add environment secret»**, не «Add environment variable» — `deploy-production.yml` читает их через `secrets.*`, а `vars.*` и `secrets.*` в GitHub Actions это разные, несовместимые контексты. Если добавить туда переменные, workflow упадёт на первом же шаге валидации входных данных.

| Secret                       | Значение                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| `PRODUCTION_SSH_HOST`        | IP сервера                                                       |
| `PRODUCTION_SSH_USER`        | `deploy`                                                         |
| `PRODUCTION_SSH_PORT`        | `22`                                                             |
| `PRODUCTION_SSH_PRIVATE_KEY` | содержимое `harmofin_deploy_key` целиком (включая `BEGIN`/`END`) |
| `PRODUCTION_KNOWN_HOSTS`     | вывод `ssh-keyscan` из шага 3                                    |
| `PRODUCTION_APP_DIR`         | `/home/deploy/harmofin`                                          |
| `PRODUCTION_BASE_URL`        | `https://<домен>`                                                |
| `PRODUCTION_ENV_FILE`        | содержимое `.env.production` целиком (см. шаг 6)                 |

- [ ] Все 8 секретов добавлены именно как Secrets, а не Variables

---

## 5. GHCR: доступ сервера к приватным образам

Публикация образов ([publish.yml](../../.github/workflows/publish.yml)) кладёт их в `ghcr.io/<owner>/harmofin-*` как **приватные** по умолчанию. Серверу нужна авторизация для `docker pull`:

```bash
ssh -i C:\путь\до\harmofin_deploy_key deploy@<IP-сервера>
echo <PAT> | docker login ghcr.io -u <github-username> --password-stdin
```

PAT — classic Personal Access Token со scope `read:packages` (https://github.com/settings/tokens). Логин сохраняется в `~/.docker/config.json` пользователя `deploy` навсегда — повторять не нужно.

Альтернатива: сделать пакеты публичными (GitHub → Packages → каждый из 4 → Package settings → Change visibility → Public) — тогда `docker login` на сервере не нужен вовсе.

- [ ] Сервер может тянуть образы (проверится на первом реальном деплое)

---

## 6. `.env.production`

Шаблон — [infra/env/staging.example](../../infra/env/staging.example). Ключевые нюансы, не очевидные из шаблона:

- **`IMAGE_TAG` в файл не добавлять** — его подставляет сам `deploy-production.yml` через `export IMAGE_TAG=...` перед вызовом `deploy.sh`; значение из `.env.production` было бы просто перезаписано.
- **`DATABASE_URL` при self-hosted Postgres** указывает на имя сервиса в Docker-сети, не на IP сервера: `postgresql://<user>:<pass>@postgres:5432/<db>`. Плюс отдельно нужны `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — их читает сам postgres-контейнер в [production.yml](../../infra/compose/production.yml).
- **SMTP через mail.ru**: порт **465** требует implicit TLS (`secure: true`), но [smtp-email.sender.ts](../../apps/api/src/auth/smtp-email.sender.ts) вызывает `nodemailer.createTransport` без `secure` — всегда STARTTLS-режим. С портом 465 соединение не установится. Использовать **порт 587** — код тогда работает без изменений.
- Секреты (`AUTH_TOKEN_HASH_SECRET`, `POSTGRES_PASSWORD`) генерировать через `openssl rand -base64 32`.

```bash
openssl rand -base64 32
```

Итоговый файл проверить локально перед заливкой в секрет:

```bash
IMAGE_TAG=test docker compose --env-file .env.production -f infra/compose/production.yml config --quiet
```

Без ошибок на выходе — значит все обязательные переменные на месте.

- [ ] `.env.production` собран и провалидирован локально
- [ ] Файл НЕ закоммичен (проверить `git check-ignore .env.production`)
- [ ] Содержимое целиком вставлено в secret `PRODUCTION_ENV_FILE`

---

## 7. DNS

A-запись домена → IP сервера. Изменение реплицируется между NS-серверами провайдера не мгновенно — до часа. Проверять **не через локальный резолвер** (у него может быть закэширован старый ответ), а напрямую у каждого авторитетного NS домена:

```bash
nslookup -type=NS <домен> 8.8.8.8   # узнать список NS
nslookup <домен> ns1.example.com     # опросить каждый NS по отдельности
```

Деплоить (шаг 8) только когда **все** NS отдают новый IP — иначе smoke-тест в конце `deploy-production.yml` не достучится до сайта (получит код `000`) и весь деплой откатится с ошибкой, хотя сами контейнеры на сервере поднимутся нормально.

- [ ] Все авторитетные NS отдают IP сервера
- [ ] Публичный резолвер (8.8.8.8) тоже видит новый IP

---

## 8. Запуск деплоя

Actions → **Deploy production** → Run workflow (`workflow_dispatch`):

- `release`: версия релиза (`1.2.3` или `v1.2.3`) либо точный commit SHA, уже опубликованный [publish.yml](../../.github/workflows/publish.yml) (проверить в Actions → Publish images → успешный прогон)
- `backup_evidence`: workflow только проверяет, что поле не пустое — для solo-проекта без отдельного staging можно указать текстовое пояснение вместо реальной ссылки
- `migration_compatibility`: для самого первого деплоя на пустую базу данных подходит `forward-only`

Дальше `deploy-production.yml` делает всё сам: заливает `infra/compose/production.yml`, `infra/caddy/Caddyfile`, `infra/scripts/*` и `.env.production` на сервер, запускает `deploy.sh` (миграция → `docker compose up -d` → ожидание healthy → smoke-тесты).

После успеха проверить вживую:

```bash
curl -sI https://<домен>/
curl -s https://<домен>/api/v1/health/live
curl -s https://<домен>/api/v1/health/ready
```

- [ ] Web отвечает 200
- [ ] `/api/v1/health/live` → `{"status":"ok"}`
- [ ] `/api/v1/health/ready` → `{"status":"ok","dependencies":{"database":"ok"}}`

---

## Баги, найденные и исправленные при первом прогоне

Ниже — реальные проблемы репозитория, вскрытые при первом деплое на self-hosted VPS. Если разворачиваешь ещё один environment с нуля и используешь актуальный `main` — они уже исправлены; раздел оставлен как справка на случай регрессии.

1. **`publish.yml`: тег GHCR с заглавными буквами**. `github.repository_owner` сохраняет регистр аккаунта (`IldusSiraev`), а GHCR требует lowercase repository name — сборка падала на `buildx failed: invalid tag ... repository name must be lowercase`. Исправлено явным приведением `${OWNER,,}` в отдельном шаге перед сборкой.
2. **`deploy.sh` не был исполняемым в Git** (`100644` вместо `100755`). `deploy-production.yml` вызывает его напрямую через `./infra/scripts/deploy.sh` по SSH — падало с `Permission denied`, exit code 126. Исправлено `git update-index --chmod=+x`.
3. **Сеть `private` в `production.yml` была `internal: true`** — то есть вообще без выхода в интернет. Из-за этого API не смог бы достучаться до внешнего SMTP (`smtp.mail.ru`) для отправки писем. Так как ни один сервис в этой сети не публикует порты наружу (`expose`, не `ports`), входящая изоляция не нужна — флаг убран, исходящий трафик разрешён.
4. **Managed PostgreSQL заменён на self-hosted контейнер** в `production.yml` — экономия на отдельном managed-инстансе для solo-проекта. Есть встроенный CI-тест (`infra/docker/production-topology.test.mjs`), который раньше явно запрещал сервис `postgres` в этом файле («production Compose... has no database service») — тест обновлён под новую политику (Postgres разрешён, но без публикации портов наружу).
5. **`infra/env/staging.example` не содержал `POSTGRES_DB/USER/PASSWORD`** — CI-шаг «Validate production Compose configuration» интерполирует `production.yml` именно этим файлом и падал на отсутствующих переменных. Добавлены placeholder'ы.
6. **SMTP-порт 465 несовместим с кодом** — см. пункт про `.env.production` в шаге 6 выше (nodemailer без `secure: true` на порт 465 не подключится). Решение — использовать порт 587 в конфигурации, а не менять код.
7. **GHCR-пакеты приватны по умолчанию** — сервер не мог тянуть образы (`Error error from registry: unauthorized`), пока не выполнен `docker login` с PAT (см. шаг 5).
8. **DNS-репликация не мгновенна** — первая попытка деплоя прошла все шаги вплоть до smoke-теста и упала именно на нём, потому что A-запись ещё не разошлась по всем NS-серверам провайдера (см. шаг 7). Сами контейнеры на сервере при этом поднялись и стали healthy — упал только внешний HTTP-запрос от GitHub Actions runner.

---

## Связанные регламенты

- `docs/runbooks/deploy.md` — процедура повторного production-деплоя на уже настроенный сервер
- `docs/runbooks/image-rollback.md` — откат на предыдущий SHA
- `docs/runbooks/secret-rotation.md` — ротация секретов после первичной настройки
- `docs/runbooks/postgres-outage.md` — диагностика self-hosted Postgres в этой топологии

---

**Версия регламента**: 2026-09-18
