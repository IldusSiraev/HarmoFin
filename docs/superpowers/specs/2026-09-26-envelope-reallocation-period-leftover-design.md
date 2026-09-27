# Дизайн: перенос остатка конверта при смене периода цикла

## Цель

Когда финансовый цикл пересекает границу периода (`10-24` → `25-9` или обратно) и конверт только что завершившегося периода всё ещё хранит ненулевой остаток, приложение должно проактивно предложить пользователю перенести этот остаток в конверт текущего периода или распределить его в другой конверт — вместо того чтобы остаток молча выпадал из виду на дашборде (виджет «Можно потратить» показывает только конверт текущего `periodSlot`).

Для переноса между конвертами вводится новая доменная сущность `EnvelopeReallocation`, поскольку существующий `Transfer` требует различающихся счетов (CLAUDE.md, п.12.4 функциональной спецификации), а баланс конверта в `financial-balance.repository.ts` не зависит от счёта — перенос между конвертами не подразумевает движения денег между счетами вообще.

## Граница

### Входит

- Новая сущность `EnvelopeReallocation`: перенос суммы с одного конверта на другой без участия счетов.
- Server-side детекция «остатка предыдущего периода» на дашборде.
- UI-баннер на дашборде с двумя явными действиями: перенести весь остаток одним кликом или открыть форму частичного/произвольного распределения.
- Idempotency, audit trail, budget isolation, role checks, логическое удаление — как у остальных финансовых сущностей.
- Обновление проекции баланса конверта с учётом `EnvelopeReallocation`.

### Не входит

- Изменение модели `Transfer` или ослабление правила «счета перевода должны различаться».
- Черновики/подтверждение в несколько шагов для реаллокации (сохраняется сразу `CONFIRMED`, как `IncomeAllocation`).
- Автоматическое выполнение переноса без явного клика пользователя.
- Изменение алгоритма определения периода/цикла (раздел 9 функциональной спецификации не меняется).
- Редактирование существующей `EnvelopeReallocation` (только создание и логическое удаление).

## Доменные правила

`EnvelopeReallocation` — самостоятельная финансовая запись бюджета: `sourceEnvelopeId`, `destinationEnvelopeId`, `amountMinor`, `occurredOn`, опциональный `comment`, `status` (`CONFIRMED` | `DELETED`), audit-поля (`createdByUserId`, `updatedByUserId`, `deletedAt`, `preDeleteStatus`) и таймстемпы. В отличие от `Transfer`, здесь нет `DRAFT`/`CANCELLED` — операция разовая и уже подтверждена самим фактом явного клика пользователя (перенести остаток / отправить форму распределения), по аналогии с `IncomeAllocationStatus`, где также нет `DRAFT`.

Сервер проверяет при создании:

- `sourceEnvelopeId !== destinationEnvelopeId`;
- оба конверта существуют, активны, принадлежат тому же `budgetId`, имеют `RUB`/`scale = 2` (тот же паттерн `isActiveRubReference`, что в transfers);
- `amountMinor > 0`;
- при `allowNegativeBalance === false` перенос не должен сделать баланс `sourceEnvelope` отрицательным (проверка через `FinancialBalanceRepository.envelopeBalance` внутри той же транзакции, аналогично `assertConfirmedExpenseCapacity`/`assertConfirmedTransferCapacity`).

Инвариант: сумма балансов source- и destination-конвертов до и после операции не меняется — перенос уменьшает один конверт и увеличивает другой строго на одну и ту же величину (аналог правила из CLAUDE.md «перевод с сохранением цели не меняет общую сумму денег», применённый к паре конвертов вместо пары счетов).

Только `CONFIRMED` записи участвуют в расчёте баланса. Логическое удаление (`DELETED` + `deletedAt` + `preDeleteStatus`) сохраняет историю и пишет audit event; восстановление не входит в объём.

## Persistence и projections

Новая additive Prisma migration добавляет:

- enum `EnvelopeReallocationStatus`: `CONFIRMED`, `DELETED`;
- таблицу `envelope_reallocations`: `id`, `budget_id`, `status`, `source_envelope_id`, `destination_envelope_id`, `amount_minor` (positive), `currency`/`scale` (зафиксированы `RUB`/`2`), `occurred_on`, опциональный `comment`, `deleted_at`, `pre_delete_status`, `created_by_user_id`, `updated_by_user_id`, таймстемпы;
- composite foreign keys `(id, budget_id)` к `envelopes` для source и destination (две отдельные relations, как `TransferPart` использует `TransferPartSourceEnvelope`/`TransferPartDestinationEnvelope`);
- индексы: `@@unique([id, budget_id])`, `@@index([budget_id, source_envelope_id])`, `@@index([budget_id, destination_envelope_id])`, `@@index([budget_id, occurred_on])`.

`FinancialBalanceRepository.envelopeBalance` расширяется двумя новыми термами по образцу существующих `transfer_parts`:

```
− SUM(reallocation.amount_minor WHERE source_envelope_id = X AND status = 'CONFIRMED')
+ SUM(reallocation.amount_minor WHERE destination_envelope_id = X AND status = 'CONFIRMED')
```

Database constraints обеспечивают `RUB`, `scale = 2`, положительную сохранённую сумму и корректный статус. Проверка активности ссылок, различия конвертов и capacity — application-service инварианты, проверяемые в той же PostgreSQL-транзакции, что и запись.

## Application services и API

Новый модуль `apps/api/src/envelope-reallocations/` (repository / application service / controller / schemas), структурно зеркалит `transfers`: repository фильтрует `budget_id` (и через него `workspace_id`/membership) прямо в SQL-запросах, application service владеет транзакцией, capacity-проверкой, аудитом и маппингом ответа; controller — только HTTP-валидация и делегирование.

Мутации используют существующий `IdempotencyService` с ключом `Idempotency-Key` — как transfers/transactions.

Маршруты под `/api/v1/budgets/:budgetId`:

- `GET /envelope-reallocations` — cursor pagination с фильтрами по дате/конверту;
- `GET /envelope-reallocations/:id`;
- `POST /envelope-reallocations` — создаёт сразу `CONFIRMED` с `Idempotency-Key`;
- `DELETE /envelope-reallocations/:id` — логическое удаление с `Idempotency-Key`.

Роль `OWNER`/`EDITOR` требуется для мутаций (как `requireMutationBudget` в transfers). Кросс-бюджетные идентификаторы возвращают `404 RESOURCE_NOT_FOUND`; недостаточный баланs source-конверта — `422 INSUFFICIENT_BALANCE` (тот же код ошибки, что у transfers/transactions); совпадающие source/destination — `400` с полем `destinationEnvelopeId`.

## Детекция остатка на дашборде

`DashboardRepository.summary` уже вычисляет баланс всех активных конвертов бюджета (`envelopeBalances`) и отдельно ищет конверт текущего периода (`envelope.findFirst({ periodSlot: period.id })`). Поскольку `PeriodSlot` имеет всего два значения (`FIRST`/`SECOND`), конверт «другого» слота — это всегда конверт только что завершившегося периода после пересечения границы.

Без дополнительного SQL-запроса: из уже полученного списка конвертов находим тот, чей `periodSlot` не равен `period.id`, и берём его баланс из уже вычисленного `envelopeBalances`. Если баланс отличен от нуля (положительный — всегда; отрицательный — только если `allowNegativeBalance`, симметрично существующим warnings), в `DashboardSummaryRecord` добавляется:

```ts
previousPeriodLeftover: {
  envelopeId: string;
  envelopeName: string;
  balanceMinor: bigint;
  currentPeriodEnvelopeId: string;
  currentPeriodEnvelopeName: string;
} | null
```

Детекция без состояния: поле пересчитывается при каждой загрузке дашборда и остаётся ненулевым (баннер продолжает показываться), пока пользователь не перенесёт/распределит остаток или не потратит его до нуля — тот же принцип, что у существующих предупреждений о нераспределённых деньгах в `DashboardWarnings.vue`. Отдельного «подтверждено/скрыто» флага не вводится.

## Web UI

Новый компонент `apps/web/app/components/dashboard/PeriodLeftoverPrompt.vue`, размещается на дашборде рядом с `DashboardWarnings.vue` (отдельно от неё, так как нужны кнопки-действия, а не просто ссылка-переход). Текст на русском:

> «У вас остались средства в конверте «{имя предыдущего конверта}» — {сумма}. Перенести их в «{имя текущего конверта}» или распределить в другой конверт?»

Два действия:

- **«Перенести остаток»** — вызывает `POST .../envelope-reallocations` с `amount` = весь остаток, `sourceEnvelopeId` = конверт предыдущего периода, `destinationEnvelopeId` = конверт текущего периода. Сам клик — явное подтверждение пользователя (аналог правила п.11.4 о предложении «Шабашка»: предложение показывается, действие сохраняется только после явного подтверждения).
- **«Распределить в другой конверт»** — открывает модалку выбора конверта (переиспользуется существующий envelope-picker компонент, если есть готовый в `apps/web/app/components/envelopes/`) с редактируемым полем суммы (по умолчанию — весь остаток) и произвольным конвертом-назначением; отправка вызывает тот же `POST .../envelope-reallocations` с выбранными значениями.

Визуальное оформление — по Calm Fintech guidelines: карточка с info/warning-иконкой, тот же паттерн отступов/типографики, что в `DashboardWarnings.vue`. Баннер скрывается сам, когда `previousPeriodLeftover` становится `null` после обновления данных дашборда (без ручного dismiss).

`useBudgetReferenceData` расширяется client-safe DTO для `EnvelopeReallocation` и idempotent-методом создания, по образцу transfer-методов.

## Тесты и acceptance

Unit-тесты (`envelope-reallocation.application.service.test.ts`): source ≠ destination, оба конверта активны/того же бюджета, capacity-check при `allowNegativeBalance` `true`/`false`, инвариант суммы source+destination неизменен, budget isolation (чужой `budgetId` → 404), логическое удаление и audit event.

PostgreSQL integration-тесты: миграция совместима с текущей схемой, транзакционность (rollback при ошибке capacity), RBAC, кросс-бюджетная изоляция, API/OpenAPI контракт, корректность проекции баланса конверта до/после переноса.

Playwright: смена периода (фикстура с датой на границе, конверт предыдущего периода с ненулевым остатком) → баннер появляется на дашборде с текстом и суммой → путь «перенести остаток» переносит всё и баннер исчезает; путь «распределить в другой конверт» открывает пикер, частичный перенос уменьшает остаток, но не обнуляет его — баннер остаётся с обновлённой суммой. Тесты идут через web UI и API, без обхода базы.

## Порядок реализации

1. Prisma migration (`EnvelopeReallocationStatus`, `envelope_reallocations`) + обновление `FinancialBalanceRepository.envelopeBalance`.
2. `envelope-reallocations` модуль (repository/service/controller/schemas), OpenAPI, unit + integration тесты.
3. Расширение `DashboardRepository`/`DashboardApplicationService` полем `previousPeriodLeftover`.
4. Web: `PeriodLeftoverPrompt.vue`, расширение `useBudgetReferenceData`, интеграция в дашборд-страницу.
5. Playwright-покрытие обоих сценариев + финальная проверка `pnpm lint`/`pnpm typecheck`/`pnpm test`.

Детальный implementation plan пишется только после ревью этого документа.
