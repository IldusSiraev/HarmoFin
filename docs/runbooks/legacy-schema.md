# Legacy-объекты схемы модели 1

Владелец не переносит бюджет на модель 2: учёт начинается с чистого листа после `docs/runbooks/budget-reset.sql` (см. [budget-reset.md](budget-reset.md)). Поэтому бюджетов и данных модели 1 в системе не будет. Код переноса и чтения/исправления истории модели 1 удалён. Объекты ниже остались в схеме только потому, что их удаление требует отдельной contract-миграции.

## Что осталось в схеме

| Объект                                                                   | Состояние после budget-reset                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| таблицы `transfer_parts`, `income_allocations`, `envelope_reallocations` | пусты; v2 в них не пишет, читателей и писателей в API/web/worker нет                         |
| `transfers.mode = LEGACY_PARTS` (enum остаётся)                          | строк нет; v2 list/get отдают только `ACCOUNT_ONLY`                                          |
| `envelopes.starting_balance_minor`                                       | v2 пишет только `0`                                                                          |
| значение `EnvelopeType.FREE_MONEY`                                       | v2 не создаёт                                                                                |
| `transactions.accounting_model_version`                                  | всегда `2`; поле остаётся в журнале и CSV                                                    |
| `budgets.plan_model_version`, `plan_model_activated_on` (DB default 2)   | всегда `2`; нужны `PlanModelPolicy`, `MODEL_VERSION_MISMATCH`, worker-фильтру и `/api/v1/me` |
| `plan_occurrences.transaction_id` (старая связь оплаты)                  | читается только как дополнительная ссылка оплаты, новые оплаты идут через `plan_payments`    |

`envelopes.period_slot` (`PeriodSlot`) не legacy: его используют конверты текущих расходов v2.

## Единственный код, который читает legacy-таблицы

`FinancialBalanceRepository` (`accountBalance`, `AsOf`, `totalCashAsOf`) по-прежнему суммирует `transfer_parts` в SQL остатка счёта. Это денежное ядро; при пустой таблице вклад равен нулю. Удалять его можно только вместе с таблицей.

## Удаление

Удаление перечисленных таблиц, колонок, enum-значений и ветки `transfer_parts` в SQL остатка счёта выполняется отдельной будущей contract-миграцией. Только после backup с проверенным восстановлением ([database-restore.md](database-restore.md)) и поиска потребителей по коду, OpenAPI и отчётам. В рамках v2.2 никаких `DROP` нет.

Граница проверяется тестом `apps/api/test/v2-legacy-boundary.integration.test.ts`: v2-действия не создают строк в legacy-таблицах.
