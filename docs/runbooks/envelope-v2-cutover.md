# Регламент перехода действующего бюджета на модель Envelope v2.2

**Триггер**: одобренный владельцем релиз Envelope v2.2 (этап 07), нужно один раз перевести действующий бюджет владельца с модели 1 на модель 2.

**Источники**: [спецификация v2.2, §13](../superpowers/specs/2026-09-29%20HarmoFin_Envelope_Plan_Model_v2.2.md), [план этапа 07](../superpowers/plans/2026-09-29-envelope-v2.2-07-migration-release.md), [регламент деплоя](deploy.md), [восстановление БД](database-restore.md), [откат образа](image-rollback.md), [запись о backup/restore](../operations/backup-restore-record.md).

**Ограничения документа**:

- Все значения в угловых скобках `<...>` — плейсхолдеры. Реальные суммы, URL БД, пароли, токены и содержимое approval-файла в Git, CI, тикеты и логи не попадают.
- Документ описывает процедуру, а не факт её выполнения. Факт репетиции восстановления фиксируется владельцем в `docs/operations/backup-restore-record.md` или в защищённой записи. В runbook нет утверждения об успешном production restore, и его нельзя принимать как такое доказательство.
- Все шаги выполняет владелец или оператор вручную. Ни один AI-агент не выполняет production-действия и не принимает решение go/no-go.
- Общий `infra/scripts/deploy.sh` и `smoke.sh` ради разового cutover не меняются. `deploy.sh` не вызывает cutover; `smoke.sh` делает только GET `/health/live`, `/api/v1/health/live`, `/api/v1/health/ready`.

---

## Роли

| Роль                     | Ответственность                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner бюджета            | Видит приватный preview, выбирает и подписывает opening assignments, цели периодов и правила пополнения, даёт согласие вне приложения, принимает go/no-go.                |
| Ответственный за release | Ведёт окно обслуживания, сверяет SHA образов, миграции и evidence, фиксирует решение и время каждого шага в `docs/operations/release-record.md`, останавливает процедуру. |
| Оператор                 | Имеет доступ к production-хосту, `.env.production` и approval-файлу; выполняет команды, не видит и не копирует суммы за пределы защищённого канала.                       |

Один человек может совмещать роли release и оператора. Owner бюджета не заменяется оператором при подписи preview.

---

## Что нужно понимать до начала

1. Цепочка выполняется **одним окном обслуживания**. Между миграцией M04, деплоем нового кода и cutover нельзя допустить ни одного нового v1-бюджета и ни одного запущенного старого писателя (web/API/worker).
2. `deploy.sh` по коду делает: `migrate` → `up -d web api worker caddy` → ожидание healthy → smoke. Он сразу открывает публичный доступ через Caddy и не имеет паузы под cutover. Поэтому **до cutover `deploy.sh` и production workflow `deploy-production.yml` не запускаются** (workflow вызывает `deploy.sh`). Порядок ниже обходит это: сначала вручную останавливается публичный доступ и старые сервисы, вручную применяется миграция, затем cutover, и только после него обычный `deploy.sh`/workflow поднимает v2-ready сервисы (его `migrate` будет no-op, миграции уже применены).
3. Миграция новых бюджетов называется `20260930000200_new_budgets_v2_default` (не `20260929000004`). Она задаёт DB default `plan_model_version = 2` и CHECK на `plan_model_activated_on`. Существующие бюджеты она не переписывает.
4. Cutover — это CLI `node dist/migrations/envelope-v2/cli.js`, который лежит в образе API (`apps/api/dist` копируется в `/app/dist`). `tsx` и dev-зависимости не используются.
5. Реальные имена, зарезервированные в коде: `application_name = harmofin-v2-cutover` (его CLI добавляет к URL сам) и ключ идемпотентности `envelope-v2-cutover`. Эти значения нельзя задавать в окружении API/worker, иначе их сессии выпадут из проверки freeze.
6. Dry-run (режим по умолчанию) **не** доказывает ни freeze, ни роль owner: он только валидирует approval-файл в read-only транзакции. Доказательства freeze и owner появляются только при `--apply`, до записи.

---

## Предусловия и критерии go/no-go

Любой невыполненный пункт — **NO-GO**: окно не начинается, ничего не меняется.

- [ ] Релизные SHA образов (`WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, `MIGRATE_IMAGE`) одинаковые, прошли CI и scan, `IMAGE_TAG` = `<release-sha>`.
- [ ] Тот же SHA выкачен на staging, smoke на staging зелёный.
- [ ] Preflight (шаг 1) не показывает блокеров, либо каждый блокер разрешён владельцем.
- [ ] Rehearsal на обезличенной staging fixture выполнен, включая повтор apply (шаг 2).
- [ ] Проверка восстановления полной БД/PITR выполнена и записана владельцем (шаг 3). Без записи — NO-GO.
- [ ] Есть свежий backup/PITR-точка, снятая **внутри окна, после остановки писателей**: `<backup-reference>`.
- [ ] Согласован recovery-план (раздел «Восстановление») и контакт DBA/провайдера.
- [ ] Owner подписал preview; approval-файл лежит вне Git на хосте с правами только для оператора.
- [ ] Staging проверка `application_name` через Prisma/pg пройдена (шаг 2, пункт «freeze на staging»).
- [ ] Нет открытого решения владельца из раздела «Решения владельца».
- [ ] Предупреждены пользователи об окне недоступности, дежурный на связи.

---

## Цепочка окна обслуживания

### Шаг 1. Read-only preflight и приватный preview (до окна)

Preflight и preview — read-only (RepeatableRead, `SET TRANSACTION READ ONLY`), записей не делают. Результат (`fingerprint`, суммы, архивные/отрицательные конверты, регулярные планы для согласования, блокеры `ARCHIVED_ACCOUNT_HAS_CASH`, `FUTURE_CONFIRMED_FACT`, `INCONSISTENT_REFERENCES` и др.) передаётся только owner через защищённый канал. Не выводить в логи CI, тикеты, чат.

- Способ получения preview: `runPreflight` / `runPreview` / `formatPreviewRu` из `apps/api/src/migrations/envelope-v2/`. Отдельного CLI для preview в репозитории нет. `<уточнить с владельцем: кто и как формирует приватный preview из этих функций на защищённой машине>`.
- При блокерах (`ARCHIVED_ACCOUNT_HAS_CASH`, `FUTURE_CONFIRMED_FACT`, `INCONSISTENT_REFERENCES`) — **стоп**. Ненулевой архивный счёт и будущие подтверждённые факты решает owner (разархивация/исправление данных отдельной задачей); подгонять данные под cutover запрещено.
- Preview не конвертирует старые `income_allocations`, `envelope_reallocations` и отрицательные `starting_balance` автоматически. Не подгонять результат под исторические контрольные числа спецификации.

### Шаг 2. Обезличенная staging fixture (репетиция)

1. Подготовить staging-БД с обезличенными данными, структурно похожими на production (архивные конверты, переводы, регулярные планы). Данные production без обезличивания на staging не копировать.
2. Применить на staging ту же миграцию и тот же образ (`<release-sha>`), затем dry-run, затем `--apply --maintenance-ack` и повтор `--apply`. Ожидание: повтор возвращает сохранённый результат (идемпотентность `envelope-v2-cutover`), назначения не дублируются; изменённый fingerprint или choices — `IDEMPOTENCY_CONFLICT`.
3. Сверить `cashUnchanged=true` в выводе CLI и балансы счетов до/после по защищённому запросу.
4. **Freeze на staging**: запустить `--apply` на staging с остановленными writers и убедиться, что (а) при запущенной API-сессии CLI падает с `MAINTENANCE_FREEZE_NOT_PROVEN`, (б) при остановленных сервисах и закрытых psql-сессиях apply проходит. Это положительный путь freeze: он не проверялся автотестами на общей БД. Отдельно проверить, что `application_name` из URL действительно доходит до PostgreSQL: во время работы CLI в `pg_stat_activity` есть сессия с `application_name = 'harmofin-v2-cutover'`. Если имя не доходит — **NO-GO**, cutover нельзя применять.
5. Убедиться, что в окружении API/worker staging и production нет `application_name` в `DATABASE_URL` и нет иных настроек, дающих им имя `harmofin-v2-cutover`.

### Шаг 3. Проверка восстановления полной БД / PITR

Выполняется владельцем или оператором до окна, на изолированной цели, по [database-restore.md](database-restore.md). Результат записывается в `docs/operations/backup-restore-record.md` (или в защищённую запись).

- Восстанавливается **вся БД**, а не отдельные таблицы планов: после первых v2-записей отдельный откат таблиц невозможен.
- Проверить: схема (`_prisma_migrations`), счётчики основных таблиц, суммарный cash по счетам совпадает с источником на момент snapshot.
- Фиксируется: дата, кем выполнено, источник/цель, длительность (для оценки окна и RTO), результат.
- Факт репетиции и её результат записывает владелец. Агент и этот runbook не подтверждают, что production restore работает.

### Шаг 4. Подпись owner preview

1. Owner просматривает приватный preview и выбирает: opening assignments, цели первого/второго периодов (`periodTargets`), правила пополнения (`fundingRules`). Отсутствие выбора = `MANUAL` / opening `0`; деньги остаются «свободными».
2. Approval-файл создаётся **вне Git**, на production-хосте в каталоге `<APPROVAL_DIR>` (владелец — оператор, режим `0700`, не внутри `<PRODUCTION_APP_DIR>` и не в рабочей копии репозитория), режим файла `0600` (`umask 077` до создания). В шелле, где файл создаётся и редактируется, **до** этого отключить историю: `set +o history; unset HISTFILE`; не использовать `echo`/heredoc с содержимым в историю, редактор — без swap/backup-файлов (`vim -n -i NONE` и т.п.) либо `<способ по решению оператора>`:

```json
{
  "budgetId": "<budget-uuid>",
  "ownerId": "<owner-user-uuid>",
  "fingerprint": "<fingerprint из preview>",
  "assignments": [
    {
      "envelopeId": "<uuid>",
      "periodStart": "<YYYY-MM-DD или опустить>",
      "openingMinor": "<minor-units строкой>"
    }
  ],
  "periodTargets": [
    {
      "envelopeId": "<uuid>",
      "periodStart": "<YYYY-MM-DD>",
      "targetMinor": "<minor-units строкой или null>"
    }
  ],
  "fundingRules": [
    {
      "envelopeId": "<uuid>",
      "type": "<MANUAL|SUM_OF_PLANS|FIXED_PER_PERIOD|SUGGESTED_FIXED|PERCENT_OF_INCOME>",
      "priority": "<число>",
      "fixedMinor": "<опционально>",
      "percentBasisPoints": "<опционально>"
    }
  ]
}
```

3. Оператор сверяет файл с согласием owner вне приложения (канал и запись согласия — по решению владельца).
   3a. **Доступ контейнера к файлу.** Процесс в образе API работает не от root: в `infra/docker/Dockerfile` создаётся `adduser --system --ingroup app app` и `USER app` (конкретный uid не зафиксирован в Dockerfile), а у сервиса `api` в `production.yml` стоит `cap_drop: ALL` (нет `CAP_DAC_OVERRIDE`, root-владелец и `0600` не помогут). Файл должен быть читаем именно uid контейнера:
   - Узнать uid/gid: `dc run --rm --no-deps api id` (вывод — числа `uid=<APP_UID> gid=<APP_GID>`).
   - Способ A (предпочтительный): `setfacl -m u:<APP_UID>:r <APPROVAL_DIR>/<approval-file>.json`. Файл остаётся `0600` у оператора, каталог `0700`. Bind-mount файла читается демоном, обход каталога контейнеру не нужен.
   - Способ B (если ACL недоступны): `sudo chown <APP_UID>:<APP_GID> <approval-file>.json && chmod 0400 <approval-file>.json`; оператор тогда читает файл через `sudo`. Не делать файл world-readable (`0644`).
   - Проверка на staging (шаг 2): dry-run внутри контейнера читает файл (нет `APPROVAL_FILE_INVALID`). Читаемость и отсутствие чужого доступа проверить `ls -l`/`getfacl` без вывода содержимого.
     3b. **Перед каждым запуском CLI** проверить, что файл существует как обычный файл: `test -f <APPROVAL_DIR>/<approval-file>.json && echo ok`. Если пути нет, Docker при bind-mount создаст на его месте **каталог**, и CLI вернёт `APPROVAL_FILE_INVALID`; такой каталог удалить, файл создать заново.
4. `fingerprint` привязан к данным на момент preview. Любое изменение данных до apply делает его устаревшим (`STALE_FINGERPRINT`) — preview и подпись надо повторить.

### Шаг 5. Окно: остановка публичного доступа и старых writers

Выполняет оператор на production-хосте, в каталоге приложения, с `.env.production` (команды выведены из `infra/compose/production.yml` и `deploy.sh`; на staging проверить дословно).

Единая обвязка (путь env-файла — по `deploy-production.yml`):

```bash
cd <PRODUCTION_APP_DIR>
set -a && . <PRODUCTION_APP_DIR>/.env.production && set +a
export COMPOSE_ENV_FILE=<PRODUCTION_APP_DIR>/.env.production
export IMAGE_TAG=<release-sha>
export SMOKE_BASE_URL=<production-base-url>
dc() { docker compose -f infra/compose/production.yml --env-file "$COMPOSE_ENV_FILE" "$@"; }
```

> Внимание: `set -a && . .env.production` загружает секреты в окружение шелла. Не выводить `env`, `printenv`, `docker compose config` (последний печатает значения секретов). Перед началом отключить историю шелла: `set +o history; unset HISTFILE`.

Откуда переменные. `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, `MIGRATE_IMAGE`, `DATABASE_URL` и остальные обязательные переменные `production.yml` приходят из `.env.production` на хосте (`deploy.sh` требует `WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATE_IMAGE IMAGE_TAG DATABASE_URL`, а `SMOKE_BASE_URL` нужен `run_deploy_smoke`; в workflow они задаются так же: `.env.production` + `COMPOSE_ENV_FILE`, `SMOKE_BASE_URL`, `IMAGE_TAG`, см. `deploy-production.yml`). `IMAGE_TAG` задаёт оператор, `<release-sha>` должен совпадать с тегами образов из `go/no-go`. Каталог `infra/compose`, `infra/caddy`, `infra/scripts` на хосте должен соответствовать `<release-sha>` (workflow загружает их при деплое; при ручном окне оператор сверяет их с тем же SHA до начала, иначе `dc` использует устаревший compose-файл).

1. Остановить публичный доступ (это же закрывает регистрацию: отдельного флага отключения регистрации в коде нет): `dc stop caddy`.
2. Остановить старые писатели: `dc stop web api worker`. PostgreSQL **не** останавливать.
3. `dc ps` — убедиться, что `caddy`, `web`, `api`, `worker` не запущены, `postgres` — healthy.
4. Опубликовать сообщение о недоступности. Зафиксировать время начала окна.
5. Остановить любые посторонние клиенты БД: ручные psql/GUI, экспортёры метрик, backup-агенты, которые держат сессии под app-role. Включая собственный открытый psql оператора.
6. Снять **backup/PITR-точку внутри окна** после остановки писателей: `<backup-reference>`. Зафиксировать. Без неё — NO-GO.

Проверка freeze по сессиям БД до миграции и до apply. Запрос выполняется оператором (результат — число строк, содержимое запросов не копировать). Допустимые строки: ожидается **ноль**:

```bash
dc exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT pid, usename, application_name, state
  FROM pg_stat_activity
  WHERE backend_type = '"'"'client backend'"'"'
    AND (datname = current_database() OR datname IS NULL)
    AND pid <> pg_backend_pid();"'
```

Ожидание: `(0 rows)`. Условие совпадает с проверкой CLI, кроме исключения `application_name = 'harmofin-v2-cutover'` (в ручном запросе исключать его не нужно: до запуска CLI таких сессий быть не должно). Сессия самого psql сюда не попадает (`pid <> pg_backend_pid()`), но во время `--apply` она будет считаться чужой, поэтому psql надо закрыть до apply.

Предупреждения:

- Ручной запрос выполняется под ролью `$POSTGRES_USER` (обычно superuser) и видит все сессии полностью. CLI подключается под app-ролью из `DATABASE_URL`: без `pg_read_all_stats` (или права видеть чужие сессии) ему часть строк видна с пустыми `datname`/`application_name`, и они считаются чужими. Поэтому чистый ручной результат **не доказывает**, что CLI пройдёт freeze. Права app-роли (`pg_read_all_stats` или иное) — вопрос DBA до go/no-go; доказательство только прогон на staging с той же ролью.
- healthcheck `pg_isready` и внешние агенты могут давать транзиентные сессии и ложный `MAINTENANCE_FREEZE_NOT_PROVEN`. На staging прогнать freeze (apply-проверку) несколько раз и зафиксировать частоту; на production повтор допустим только после нового нулевого запроса.

Если строки есть — не продолжать: выяснить владельца сессии, остановить сервис или дождаться завершения. Принудительное завершение сессий (`pg_terminate_backend`) — решение release-ответственного и записывается; без него — стоп.

### Шаг 6. Применение миграции M04 при остановленных writers

Миграцию применяет тот же контейнер `migrate`, что в `deploy.sh`. Это единственное, что берётся из `deploy.sh` до cutover:

```bash
dc run --rm migrate
```

- Применяются все pending-миграции, включая `20260930000200_new_budgets_v2_default`. Код новых бюджетов (v2 default) ещё **не запущен**: `api` остановлен.
- Ошибка миграции — стоп. Не повторять «до зелёного». До первой записи v2 решение — по разделу «Восстановление».
- После миграции остановленный старый `api` не должен быть запущен случайно: `restart: unless-stopped` уважает ручную остановку, но `dc up -d` без аргументов поднимет его (с образом `<release-sha>`). Поэтому в окне использовать только явные команды этого runbook.
- Миграция не меняет существующие бюджеты (`plan_model_version = 1` остаётся 1).

Проверка миграции: `dc run --rm migrate` повторно должен сообщить «No pending migrations» (повторный запуск идемпотентен). Если нужна проверка колонки, использовать отдельную read-only SQL-проверку на усмотрение оператора, без вывода пользовательских данных.

### Шаг 7. Cutover: dry-run, затем apply

Запуск CLI внутри образа API по определению сервиса `api` из `infra/compose/production.yml` (он получает `DATABASE_URL`, `read_only`, сеть `private`). `--no-deps` не поднимает лишнее, `run` не публикует порты. Approval-файл монтируется read-only из каталога вне Git:

```bash
dc run --rm --no-deps \
  -v <APPROVAL_DIR>/<approval-file>.json:/run/approval/approval.json:ro \
  api node dist/migrations/envelope-v2/cli.js \
    --budget-id <budget-uuid> \
    --approval-file /run/approval/approval.json \
    --dry-run
```

`<уточнить по infra/compose>`: не выполнялась ни на staging, ни на production. Перед первым использованием проверить на staging, что (а) `run` с переопределением CMD работает, (б) read-only файловая система не мешает, (в) путь монтирования доступен пользователю `app` (образ работает не от root), (г) том `-v` разрешён политикой хоста.

**Проверка цели до `--apply`**: CLI печатает `Target: <host:port>/<database>` (без учётных данных) и **сразу** подключается, пауз и подтверждения нет, поэтому Ctrl+C `--apply` от неверной цели не защищает. Цель проверяется заранее:

1. На **dry-run** сверить строку `Target:` с ожидаемым `<expected-host>/<expected-database>`. Несовпадение — стоп, `--apply` не запускать.
2. Независимо: `dc exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select current_database()"'` — база должна совпасть с `<expected-database>` из `Target:`; host в `DATABASE_URL` должен указывать на сервис `postgres` этого compose-проекта (проверить без печати пароля, например сравнением хоста с ожидаемым значением).
3. Каталог `infra/compose` на хосте соответствует `<release-sha>` (см. шаг 5), `IMAGE_TAG` = `<release-sha>`.

Dry-run: ожидается `Mode: DRY-RUN`, предупреждение «Dry-run does not prove the maintenance freeze or the owner role.» и строка `OK modelVersion=1 assignments=<N> cashUnchanged=true`. Dry-run ничего не записывает и **не заменяет** проверку freeze и owner.

Go/no-go перед apply (отдельное решение owner + release): dry-run `OK`, freeze-запрос (шаг 5) возвращает 0 строк, psql закрыт, backup из окна записан, approval не менялся.

Apply (однократно):

```bash
dc run --rm --no-deps \
  -v <APPROVAL_DIR>/<approval-file>.json:/run/approval/approval.json:ro \
  api node dist/migrations/envelope-v2/cli.js \
    --budget-id <budget-uuid> \
    --approval-file /run/approval/approval.json \
    --apply --maintenance-ack
```

Что делает `--apply`: блокирует бюджет, в Serializable-транзакции (до 3 повторов только при serialization conflict) повторно проверяет роль owner, freeze по `pg_stat_activity`, fingerprint и preview; затем создаёт периоды, цели, правила, opening assignments, audit и переключает `planModelVersion=2`, `planModelActivatedOn=<cutover date>`; сверяет cash и откатывает всё при расхождении. Денежных движений не создаёт.

Сверка cash до/после: CLI **не печатает суммы** (вывод — `OK modelVersion=2 assignments=<N> cashUnchanged=true` и `requestId` только в ошибках). Внутри транзакции расхождение даёт `CASH_CHANGED` и откат. Оператор проверяет: `cashUnchanged=true`, `modelVersion=2`, `assignments=<N>` равно числу в approval. Дополнительную внешнюю сверку балансов счетов с preview делает owner в приватном канале после запуска (суммы в логи не писать).

Повтор `--apply` безопасен: с теми же fingerprint и choices вернёт сохранённый результат без второго preflight (ключ `envelope-v2-cutover`; повтор принимается для того же `ownerId`), с изменёнными — `IDEMPOTENCY_CONFLICT`.

### Шаг 8. Запуск v2-ready web/API/worker и read-only smoke

Только после успешного apply. Обычный деплой, без изменений скрипта:

```bash
./infra/scripts/deploy.sh
```

(или production workflow `deploy-production.yml` с тем же `<release-sha>` и `migration_compatibility`, согласованной с release). `deploy.sh` выполнит `migrate` (no-op), `up -d web api worker caddy`, дождётся healthy и запустит `smoke.sh` (три GET-проверки). Новые бюджеты в этот момент создаются уже в v2.

Ограничение: `deploy.sh` одним шагом открывает Caddy и все сервисы, а smoke идёт уже по публичному адресу. «Открытие» регистрации и v2-writes происходит тем же действием, отдельной паузы между «smoke» и «открытием» нет (см. «Решения владельца»).

После деплоя:

- [ ] `smoke.sh` зелёный (3 проверки), `dc ps` — все сервисы healthy.
- [ ] Owner входит под своей учётной записью и видит бюджет в v2; данные, которые он сверяет по preview, совпадают; ни одной новой физической операции.
- [ ] Свежая регистрация тестового пользователя (если согласована владельцем) создаёт бюджет v2.
- [ ] В логах нет сумм, URL БД, токенов, содержимого approval-файла.

### Шаг 9. Мониторинг

Окно наблюдения не менее 30 минут по [deploy.md](deploy.md) шаги 9–10: error rate, latency, очередь worker, соединения с БД, логи. Первая запись v2 после открытия делает restore из окна допустимым только по «Восстановление» ниже.

---

## Остановка и действия при ошибках CLI

Любая ошибка CLI печатает `FAILED code=<КОД> [blockers=...] requestId=<uuid>` без payload. До успешного `OK` при `--apply` запись откатывается целиком: бюджет остаётся v1, суммы счетов не меняются.

| Код                                                                                                                                | Смысл                                                                                                                                                                                                                                                                                 | Действие                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STALE_FINGERPRINT`                                                                                                                | данные изменились после preview                                                                                                                                                                                                                                                       | Стоп. Выяснить, кто писал (freeze нарушен?), повторить preview и подпись owner. Не править fingerprint в файле вручную.                          |
| `MAINTENANCE_FREEZE_NOT_PROVEN`                                                                                                    | есть чужие сессии или нет прав прочитать `pg_stat_activity`                                                                                                                                                                                                                           | Стоп. Найти сессии запросом шага 5, остановить источник, повторить. Если сессий нет, а ошибка остаётся — проблема прав роли БД: `<решение DBA>`. |
| `PREVIEW_BLOCKED` (`blockers=...`)                                                                                                 | preview содержит блокеры (`ARCHIVED_ACCOUNT_HAS_CASH`, `FUTURE_CONFIRMED_FACT`, `INCONSISTENT_REFERENCES`, `ASSIGNMENTS_EXCEED_CASH`, `DUPLICATE_ASSIGNMENT`, `PERIOD_NOT_IN_CYCLE`, `INVALID_FUNDING_RULE`, `SAVINGS_PLAN_DOUBLE_CONTRIBUTION`, `MULTIPLE_RULES_PER_ENVELOPE` и др.) | Стоп. Коды блокеров, не суммы. Архивный счёт с деньгами и будущие факты — решение owner. Исправление — через новый preview и новую подпись.      |
| `OWNER_REQUIRED`                                                                                                                   | `ownerId` из файла не активный owner/manager воркспейса бюджета                                                                                                                                                                                                                       | Стоп. Проверить подпись и `ownerId`, не подставлять другого пользователя без решения owner.                                                      |
| `CASH_CHANGED`                                                                                                                     | cash после записи не равен cash из preflight                                                                                                                                                                                                                                          | Транзакция откатана. Стоп. Это инцидент: сообщить release/owner, расследовать до любой повторной попытки.                                        |
| `IDEMPOTENCY_CONFLICT`                                                                                                             | cutover уже выполнялся с другим fingerprint/choices                                                                                                                                                                                                                                   | Стоп. Не менять файл. Проверить состояние: бюджет, возможно, уже v2.                                                                             |
| `PLAN_MODEL_NOT_V1`, `BUDGET_NOT_FOUND`                                                                                            | бюджет уже v2 или не тот `budget-id`                                                                                                                                                                                                                                                  | Сверить `budget-id`. Если v2 уже установлен — не повторять apply, перейти к проверкам после cutover.                                             |
| `APPROVAL_FILE_INVALID`, `APPROVAL_BUDGET_MISMATCH`, `MAINTENANCE_ACK_REQUIRED`, `ARGUMENT_VALUE_MISSING`, `DATABASE_URL_REQUIRED` | ошибка запуска                                                                                                                                                                                                                                                                        | Исправить команду/файл/окружение. Не ослаблять защиту.                                                                                           |
| `CUTOVER_FAILED`                                                                                                                   | непредвиденная ошибка                                                                                                                                                                                                                                                                 | Стоп. Передать `requestId` разработчикам, не повторять `--apply` без причины.                                                                    |

Общие правила остановки:

- Не вызывать `--apply` повторно «на удачу», пока причина не названа и не записана.
- Не очищать `idempotency_keys`, не править `plan_model_version` вручную SQL.
- Если окно затянулось и нужно вернуть сервис, это решение owner+release: см. раздел «Что если cutover не прошёл» ниже. Простое `dc up -d` запустит новый API с новой схемой и v1-бюджетом без cutover (нельзя без решения владельца).

---

## Контроль отсутствия секретов и сумм в логах

- CLI печатает только `host:port/database`, режим, `OK modelVersion/assignments/cashUnchanged` и `FAILED code requestId`. Пароль БД и суммы не печатаются.
- Не выполнять `set -x`, `docker compose config`, `env`, `cat` approval-файла в сессии, записываемой в историю или лог-коллектор.
- После окна: просмотреть логи API/worker и вывод оператора за окно на предмет сумм, URL с паролем, содержимого approval-файла. Обнаруженное — инцидент по [secret-rotation.md](secret-rotation.md) / [incident-escalation.md](incident-escalation.md).
- Approval-файл **обязательно удаляется с production-хоста** после успешного окна и после просмотра логов (проверка на отсутствие сумм/секретов выше): `shred -u <APPROVAL_DIR>/<approval-file>.json` (на журналируемых/COW/SSD-файловых системах и при снапшотах `shred` не гарантирует стирание: дополнительно удалить каталог и учесть снапшоты/backup хоста, `<решение DBA/оператора>`). Сохранение допустимо только как зашифрованная копия вне хоста, одобренная owner; в Git, CI-артефакты, тикеты и чат — никогда. Проверить также, что копий нет в истории шелла и временных файлах редактора. Если окно прервано и cutover не применён, файл удаляется так же (fingerprint всё равно устареет).

---

## Восстановление

Автоматического rollback БД нет (`deploy.sh` не содержит функции отката БД). Старый образ **не** является автоматическим откатом.

1. **До первой записи v2** (cutover не применён или упал; либо применён, но сервисы ещё не открыты): допустимо восстановление полной БД из проверенного backup/PITR окна по [database-restore.md](database-restore.md). Решение принимают owner и release, перед этим фиксируется причина. Сервисы остаются остановленными, пока восстановление не проверено. После restore повторять окно с шага 1.
2. **После первой записи v2** (пользователь или worker создал v2-назначение/операцию после открытия): откатить только таблицы планов или вернуть старый образ нельзя. Допустим только заранее согласованный forward recovery: исправление данных и кодом, повторный выпуск нового SHA. Полный restore после этого момента теряет все новые записи, это решение владельца с оценкой потерь.
3. `image-rollback.md` (`run_rollback`) не использовать для возврата на v1-образ после cutover: схема и модель бюджета несовместимы с v1-кодом.
4. План forward recovery (кто, как быстро, какой SHA, как сообщить пользователям) согласуется до окна: `<описать до go/no-go>`.

### Что если cutover не прошёл

Миграция M04 уже применена (шаг 6), бюджет остался v1. Старый код запускать нельзя: DB default `plan_model_version = 2` и CHECK ломают регистрацию в старом приложении. Новый код с v1-бюджетом не проверялся. Допустимые решения — только по выбору владельца:

- устранить причину и повторить cutover в том же или следующем окне, сервисы остаются остановленными;
- восстановить полную БД из backup окна (до первой записи v2) и перенести окно.

---

## Ручной release gate (чек-лист)

Выполняет владелец/оператор. Агенты не подтверждают пункты.

- [ ] Restore-репетиция на staging выполнена, запись создана: `<ссылка на запись>`
- [ ] Staging cutover (dry-run, apply, повтор apply) выполнен на обезличенной fixture
- [ ] Freeze и `application_name` на staging проверены (положительный и отрицательный путь)
- [ ] Preflight без неразрешённых блокеров
- [ ] Owner подписал preview, approval-файл вне Git
- [ ] Решения владельца из раздела ниже приняты и записаны
- [ ] **Go/no-go #1**: начать окно (backup внутри окна, writers остановлены, `pg_stat_activity` = 0 строк)
- [ ] Миграция M04 применена при остановленных writers
- [ ] Dry-run `OK`, цель БД сверена
- [ ] **Go/no-go #2**: выполнить `--apply --maintenance-ack`
- [ ] Apply `OK`, `cashUnchanged=true`, число assignments сходится
- [ ] **Go/no-go #3**: запуск `deploy.sh` / production workflow для `<release-sha>`
- [ ] Smoke зелёный, owner проверил бюджет, мониторинг 30+ минут
- [ ] Логи за окно просмотрены, секретов и сумм нет
- [ ] Approval-файл удалён с хоста (`shred -u`), история шелла не содержит его содержимого; зашифрованная копия вне хоста — только по решению owner
- [ ] Release-record обновлён (времена, SHA, backup reference, решения)

---

## Решения владельца (выбор, а не выдумка)

1. **Preview**: нет отдельного CLI для preview; способ формирования приватного preview из `runPreflight/runPreview` надо определить (на защищённой машине, через временный запуск, либо отдельной задачей).
2. **Открытие**: `deploy.sh` поднимает Caddy и сервисы сразу, smoke идёт по публичному адресу и до этого не проверен на staging в рамках этого окна, пауза между smoke и открытием регистрации отсутствует (открытое решение до go/no-go). Принять как есть, либо отдельной задачей добавить стадийный запуск (без Caddy, затем Caddy). Скрипт в рамках M05 не менялся.
3. **Закрытие регистрации**: флага отключения регистрации нет; закрытие обеспечивается остановкой Caddy и API. Принять либо запросить отдельную задачу.
4. **Команда CLI в `dc run`**: форма выведена из compose-файлов и не запускалась; проверяется на staging (шаг 7). Альтернатива — запуск через `docker run` с тем же образом и сетью.
5. **Production workflow**: до cutover не запускать. Для шага 8 выбрать: `./infra/scripts/deploy.sh` на хосте или workflow `deploy-production.yml` (требует approval environment). Согласованное значение `migration_compatibility`: `<forward-only по умолчанию, решает release>`.
6. **Бюджет окна/RTO**: по результатам staging-репетиции `<оценка длительности>`; допустимая недоступность `<решение owner>`.
7. **Forward recovery план** после первой записи v2: `<владелец до go>`.
8. **Роль owner в БД**: если роль БД под app не имеет прав читать чужие записи `pg_stat_activity` (скрытые строки), CLI не докажет freeze: `<решение DBA>`.

---

## Проверка runbook

Автоматические проверки для самого документа, выполненные при подготовке (локально, без production-действий):

```bash
bash infra/scripts/deploy.test.sh
bash infra/scripts/smoke.test.sh
test -f docs/runbooks/envelope-v2-cutover.md
pnpm exec prettier --check docs/runbooks/envelope-v2-cutover.md
```

Эти проверки подтверждают, что shell-скрипты проходят свои тесты и документ существует и отформатирован. Они **не** доказывают корректность процедуры на production, восстановление БД или работу freeze. Это закрывается staging-репетицией и ручным release gate.

---

## Связанные документы

- [deploy.md](deploy.md), [image-rollback.md](image-rollback.md), [database-restore.md](database-restore.md), [secret-rotation.md](secret-rotation.md), [incident-escalation.md](incident-escalation.md)
- [backup-restore-record.md](../operations/backup-restore-record.md), [release-record.md](../operations/release-record.md)
- `infra/compose/production.yml`, `infra/scripts/deploy.sh`, `infra/scripts/smoke.sh`
- `apps/api/src/migrations/envelope-v2/cli.ts`, `cutover.ts`
