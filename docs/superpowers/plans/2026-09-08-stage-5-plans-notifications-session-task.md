# Stage 5: регулярные планы, occurrences, worker и внутренние уведомления

## Назначение

Этот документ — задача для новой Claude Code сессии. Он задаёт только подготовку согласованного дизайна и подробного implementation plan для следующего этапа HarmoFin. Реализацию production-кода нельзя начинать до отдельного пользовательского подтверждения design и plan.

## Предусловие

Начинать после merge Stage 3b в `main`. Создать новую ветку от актуальной `main`:

```bash
git switch main
git pull --ff-only
git switch -c feat/stage-5-plans-notifications
```

Работать в текущем checkout, без worktree и subagents. После каждого утверждённого Task останавливаться и ждать явного подтверждения. Не переходить к следующему Task автоматически.

## Обязательные источники

До любых продуктовых или архитектурных решений прочитать:

- `CLAUDE.md`;
- `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`:
  - раздел 13 «Регулярные планы»;
  - разделы 14.1–14.2;
  - раздел 15 «Уведомления»;
  - критерии приемки 21.7;
- `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`:
  - раздел 8 «Фоновые задачи и уведомления»;
  - раздел 19, этап 5;
  - требования к worker, PostgreSQL-backed jobs, concurrency и idempotency;
- существующие реализации Stage 3a, Stage 3b и Stage 4: operations, allocations, transfers, cycles, dashboard, worker, audit и idempotency.

## Цель Stage 5

Реализовать MVP регулярных планов и внутреннего центра уведомлений:

- планы доходов, расходов и накоплений;
- materialized occurrences;
- отдельный worker с PostgreSQL-backed scheduling и защитой от конкурентного запуска;
- внутренние уведомления по планам и финансовым предупреждениям;
- создание черновика или явно подтверждаемой пользователем фактической операции из occurrence;
- ближайшие обязательства на dashboard;
- страницы `/app/plans` и `/app/notifications`.

## Неподвижные правила

- План и occurrence никогда не изменяют остатки счетов, конвертов, period limits или reports.
- Только подтверждённая фактическая операция влияет на финансовые projections.
- Worker не создаёт подтверждённую фактическую операцию автоматически.
- Пропуск occurrence не создаёт расход.
- Создание операции из occurrence prefill-ит форму; пользователь может изменить сумму, дату, счёт, категорию, конверт и комментарий до явного подтверждения.
- Все денежные значения: PostgreSQL `BIGINT`; API boundary принимает decimal strings и возвращает canonical integer strings.
- Каждая user-data query/mutation фильтрует `workspace_id` и `budget_id` в SQL. Чужие object IDs возвращают `404 RESOURCE_NOT_FOUND`.
- Каждая финансовая mutation использует существующую idempotency модель.
- Все изменения планов, occurrences и уведомлений пишут audit events.
- UI и user-facing errors — на русском.
- Не включать CSV/XLSX import, bank integrations, Telegram, email/push delivery, AI, multi-currency conversion, collaborative UI, billing или plan-vs-actual analytics. Plan-vs-actual report остаётся Stage 6.
- Playwright scenarios писать для CI. Локально browser suite не запускать без отдельного явного запроса пользователя.

## Первый Task: дизайн и implementation plan

1. Создать design document:

   ```text
   docs/superpowers/specs/2026-09-08-stage-5-plans-notifications-design.md
   ```

2. Зафиксировать до реализации:

   - Prisma contract для `RegularPlan`, `PlanOccurrence`, `Notification` и PostgreSQL job/lease model;
   - exact plan types и recurrence model: one-time, monthly, every N months, yearly;
   - правило для дат, отсутствующих в месяце, включая 29–31 число и leap years;
   - occurrence lifecycle: pending, due, skipped, completed/cancelled;
   - связь occurrence с созданной фактической transaction;
   - поведение при изменении, отключении или удалении плана;
   - границы backfill и look-ahead window worker;
   - уникальность occurrence и notification per occurrence/type;
   - locking, lease, retry и recovery после restart worker;
   - notification rules для upcoming/today/overdue plan, unallocated income, negative account/envelope balance и insufficient mandatory obligations;
   - read/unread state и action link notification;
   - DTO/OpenAPI endpoints, roles, Problem Details и audit payload allowlist;
   - server projections для ближайших обязательств dashboard;
   - responsive/accessibility contract web pages.

3. Создать detailed implementation plan:

   ```text
   docs/superpowers/plans/2026-09-08-stage-5-plans-notifications.md
   ```

4. Разбить implementation на изолированные Tasks. Для каждого определить:

   - точные files;
   - additive migration strategy;
   - red/green tests;
   - API/OpenAPI contracts;
   - worker concurrency/retry tests;
   - budget-isolation и role tests;
   - UI tests;
   - CI-only Playwright coverage;
   - per-Task commit message;
   - final quality gate.

5. Представить design decisions и implementation plan. Остановиться до первого implementation Task и ждать подтверждения.

## Ожидаемые implementation milestones

После утверждения plan разбить работу минимум на:

1. Persistence/migration и DB constraints.
2. Regular plan domain, application service, repository и API.
3. Occurrence generation и PostgreSQL-backed worker lease/job handling.
4. Internal notifications domain/API и worker rules.
5. Create-operation-from-occurrence flow с idempotency и audit.
6. Dashboard upcoming-obligations server projection.
7. Plans web UI.
8. Notifications web UI.
9. Integration, worker-concurrency и CI-only browser coverage.
10. Final quality gate.

## Финальная проверка Stage 5

Перед завершением implementation выполнить:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose -f infra/compose/local.yml config --quiet
pnpm db:migrate
```

Не запускать `pnpm test:e2e` локально без нового явного разрешения пользователя.
