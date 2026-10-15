# Сброс бюджета на чистый лист (модель v2)

Файл: `docs/runbooks/budget-reset.sql`. Удаляет все учётные данные одного бюджета владельца и переводит бюджет на модель v2, как у только что зарегистрированного пользователя. Операция необратима без backup.

## Что делает

Один блок `DO`, одна транзакция. Находит пользователя по `target_email` (без учёта регистра), его бюджет через активное членство OWNER. Если бюджет не ровно один, в его рабочем пространстве не ровно один активный OWNER или `target_email` остался заглушкой, скрипт останавливается с ошибкой и ничего не меняет.

Удаляет строки с `budget_id` этого бюджета в таком порядке: `plan_payments`, `notifications`, `envelope_assignments`, `envelope_movements`, `envelope_periods`, `envelope_funding_rules`, `envelope_reallocations`, `income_allocations`, `transfer_parts`, `transfers`, `plan_occurrences`, `regular_plans`, `transactions`, `idempotency_records`, `budget_cycle_revisions`, `envelopes`, `categories`, `accounts`.

`audit_events` не удаляются: у записей бюджета `budget_id` становится NULL, а `workspace_id`, исполнитель и `entity_id` сохраняются. Физически удаляются только финансовые записи, и только по явной просьбе владельца; восстановить их можно лишь из backup.

Затем обновляет строку бюджета: `plan_model_version = 2`, `plan_model_activated_on` = сегодня в часовом поясе бюджета, правило распределения дохода выключено, `income_allocation_source_category_id` и `income_allocation_target_envelope_id` равны NULL. В конце проверяет по `information_schema`, что ни в одной таблице с колонкой `budget_id` не осталось строк бюджета; иначе откатывает всё.

В аудит добавляется одна запись `budget.reset` (без `budget_id`, только счётчики строк, без сумм).

## Чего не трогает

Пользователя, сессии, рабочее пространство, членство, сам бюджет (имя, часовой пояс, валюту, `cycle_start_day`, `period_boundary_offset`, `allow_negative_balance`, статус), чужие бюджеты и пользователей, `worker_jobs`, `recovery_tokens`. Скрипт не использует DROP и TRUNCATE и не отключает триггеры и внешние ключи.

## Как запускать

1. Сделайте backup и проверьте его восстановление по `database-restore.md`.
2. Остановите API и worker, чтобы они не писали в бюджет во время сброса.
3. Скопируйте скрипт, в блоке параметров укажите `target_email`. `commit_changes` оставьте `false`.
4. Dry-run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f budget-reset.sql`.
5. Прочитайте вывод (см. ниже). Если всё ожидаемо, поставьте `commit_changes := true` и запустите снова.
6. Запустите API и worker, войдите и при желании примените шаблон.

Перед запуском на рабочей базе проверьте хост и имя базы в `DATABASE_URL`.

## Запуск на production-сервере (Docker Compose)

Production работает в Docker Compose под проектом `harmofin-production`; приложение лежит в `~/harmofin`, БД в контейнере `harmofin-production-postgres-1`. На хосте нет `psql`, поэтому скрипт передаётся в `psql` внутри контейнера через stdin. Файл скрипта правится на лету через `sed`, сам он в репозитории остаётся с заглушкой. Подставляется только строка присваивания `target_email`: заглушка также встречается в проверке `IF ... = 'owner@example.com'`, и заменять её там нельзя, иначе проверка сломается.

Email должен быть без символов `'`, `&`, `|` и `\`. Все команды выполняются на сервере под пользователем `deploy`.

1. **Положите скрипт на сервер.** Со своей машины, из корня репозитория:

   ```bash
   scp docs/runbooks/budget-reset.sql deploy@<хост>:~/harmofin/budget-reset.sql
   ```

2. **Сделайте backup.** Креды берутся из самого контейнера, env-файл не нужен:

   ```bash
   docker exec harmofin-production-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > ~/harmofin/before-budget-reset-$(date +%F-%H%M).dump
   ```

   Проверьте, что файл не пустой (`ls -lh ~/harmofin/*.dump`). Порядок восстановления: `database-restore.md`.

3. **Остановите API и worker**, чтобы они не писали в бюджет. Web и Caddy можно оставить:

   ```bash
   docker stop harmofin-production-api-1 harmofin-production-worker-1
   ```

4. **Dry-run.** Задайте email и запустите. `commit_changes` остаётся `false`, в базе ничего не изменится:

   ```bash
   EMAIL='user@example.com'
   sed "s|^\(  target_email   text    := \)'owner@example.com';|\1'${EMAIL}';|" ~/harmofin/budget-reset.sql \
     | docker exec -i harmofin-production-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f -'
   ```

   Прочитайте вывод по разделу «Как читать dry-run» ниже. Нормальный итог: строки `NOTICE: обработано в ...` и в конце ошибка `DRY RUN: изменения откатены`. Любая другая ошибка означает, что изменений нет, переходить к шагу 5 нельзя.

5. **Коммит.** Та же команда, но с `commit_changes := true`:

   ```bash
   EMAIL='user@example.com'
   sed -e "s|^\(  target_email   text    := \)'owner@example.com';|\1'${EMAIL}';|" \
       -e "s|^\(  commit_changes boolean := \)false;|\1true;|" ~/harmofin/budget-reset.sql \
     | docker exec -i harmofin-production-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f -'
   ```

   Ошибки `DRY RUN` в этот раз быть не должно, блок завершается успешно.

6. **Запустите API и worker обратно:**

   ```bash
   docker start harmofin-production-api-1 harmofin-production-worker-1
   ```

   Проверьте, что оба контейнера `healthy` (`docker ps`), войдите под этим пользователем: бюджет должен быть пустым, без счетов, конвертов и операций.

7. **Уберите скрипт с сервера:**

   ```bash
   rm ~/harmofin/budget-reset.sql
   ```

   Дамп из шага 2 оставьте до тех пор, пока владелец не подтвердит результат.

Если на шаге 5 что-то пошло не так (пользователь не найден, бюджетов не один, превышено ожидание блокировки), транзакция откатывается целиком, данные не меняются. Если сброс прошёл, но он был нежелателен, восстановление возможно только из дампа шага 2 по `database-restore.md`.

## Как читать dry-run

Каждая строка `NOTICE: обработано в <таблица> ...: N` показывает, сколько строк удалит скрипт (для `audit_events_detached` отвяжет). Последняя строка `NOTICE: budgets: plan_model_version=2, plan_model_activated_on=...` показывает новую дату активации. Затем всегда следует ошибка `DRY RUN: изменения откатены`: это нормальный результат, в базе ничего не изменилось. При `commit_changes := true` ошибки нет, блок завершается успешно.

Любая другая ошибка (пользователь не найден, бюджетов не один, остались строки в таблице, превышено ожидание блокировки) означает, что изменений нет. Не запускайте с `commit_changes := true`, пока причина не устранена.
