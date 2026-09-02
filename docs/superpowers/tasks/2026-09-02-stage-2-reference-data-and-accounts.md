# Задача следующей сессии: Этап 2 — справочники и счета

## Сначала изучить

1. [Функциональное ТЗ](../specs/2026-08-30-family-budget-app-spec.md): разделы 5.2, 5.3, 6, 7, 8, 14.5, 14.6, 17, 20 и 21.1.
2. [Спецификацию разработки](../specs/2026-08-30-family-budget-development-spec.md): разделы 6.2–6.9, 7, 10, 12, 14, 16, 19.2 и 21.
3. Текущий `main` после merge Этапа 1: Prisma schema/migrations, auth, workspace/budget boundaries, OpenAPI, API/web test conventions, CI и README.
4. [Дизайн Этапа 1](../specs/2026-08-31-stage-1-database-auth-design.md), чтобы не ломать существующие session, authorization, audit и budget isolation.
5. [UI foundation](../specs/2026-09-02-ui-foundation-design.md) как источник design tokens, accessibility rules и контрактов web-компонентов.

Работать в **новой feature branch**, без worktree.

## Обязательный порядок

1. Сначала подготовить дизайн Этапа 2 и согласовать его с пользователем. До одобрения не менять runtime-код, schema или migrations.
2. После одобрения создать implementation plan с разбивкой на test-first задачи и согласовать его.
3. Реализовать plan, делая небольшие тематические commits.
4. Перед завершением выполнить полный CI gate и проверить web flow в браузере.

## Цель Этапа 2

Добавить подготовительные финансовые сущности без финансовых операций:

- счета и начальные балансы;
- категории доходов и расходов;
- конверты и начальные остатки;
- настройки бюджета;
- server-confirmed базовые балансы;
- API/OpenAPI, audit и русскоязычный web UI настроек.

Этап создаёт надежный фундамент для операций Этапа 3. Он **не** вводит income/expense/transfer transactions, allocations, финансовые циклы, планы, уведомления, аналитику или внешние интеграции.

## Реализовать

### 1. Prisma schema и migration

Добавить новую migration, совместимую с существующей БД Этапа 1. Не переписывать первую migration.

Добавить как минимум:

- `accounts`;
- `categories`;
- `envelopes`;
- поля настроек бюджета, которых не хватает для acceptance scope Этапа 2.

Точные имена, enum и constraints утвердить в дизайне. Модель должна поддерживать требования ТЗ:

- счет принадлежит ровно одному `budget_id`;
- типы счетов MVP: банковский счет, банковская карта, наличные;
- только `RUB` в MVP;
- полное платежное средство не хранить: допустимы только необязательные название банка и последние цифры;
- начальные баланс/остаток — integer minor units (`BIGINT`), не `float` и не decimal в JavaScript;
- API принимает денежные значения как decimal strings, сервер валидирует их и преобразует в minor units;
- хранить валюту и scale, даже если Этап 2 ограничен `RUB`/`2`;
- неизменяемые финансовые записи не удалять физически; для счетов, категорий и конвертов использовать подходящий active/archive state и timestamp;
- добавить `budget_id` в таблицы и scope-aware unique constraints/indexes, например уникальность display name внутри бюджета с явно выбранной семантикой для archive state;
- добавлять foreign keys, check constraints для допустимых enum/дней/денежных диапазонов и индексы часто используемых filters;
- время хранить в UTC.

Нужные budget settings:

- название;
- `primary_currency=RUB`;
- timezone;
- день начала финансового цикла (`1..28`);
- offset границы двух периодов (`1..27`);
- `allow_negative_balance`;
- fields, необходимые для будущего правила `Шабашка → Ремонт`, но без реализации allocations.

Нельзя добавлять таблицы операций «на будущее», если они не нужны Этапу 2.

### 2. Бизнес-правила счетов и базовых балансов

Реализовать server-side validation и application services:

- создание, просмотр, список, редактирование и архивирование счета;
- для нового счета обязательны name, account type, `RUB`, starting balance и accounting start date;
- допускается отрицательный начальный баланс только если это явно разрешено утвержденным дизайном и согласовано с budget setting; не строить расходную логику раньше Этапа 3;
- `currentBalanceMinor` на Этапе 2 равен `startingBalanceMinor`; это серверный расчёт/response field, а не client source of truth;
- archived account остаётся доступен в истории и в явном list/archive mode, но помечается недоступным для будущих новых операций;
- изменяемые поля и archive action создают audit events c old/new values без sensitive data;
- не логировать суммы полного request payload, карточные данные, cookie, password или token.

### 3. Категории

Реализовать scoped CRUD/archiving для categories:

- типы `INCOME` и `EXPENSE`;
- name, optional future parent reference, active/archive state, display order, optional comment;
- API list filter по category type и active/archive state;
- category belongs to same budget query filter;
- запрещать физическое удаление;
- базовые default categories из функционального ТЗ: разделы 8.1 и 8.2;
- начальная категория должна быть создана так, чтобы повторный local seed не плодил дубли.

UI Этапа 2 показывает категории по типам. Фильтрация категории в форме операции — задача Этапа 3.

### 4. Конверты

Реализовать scoped CRUD/archiving для envelopes:

- name;
- type: текущие расходы, обязательные расходы, накопительная цель, резерв, свободные деньги, пользовательский тип;
- `startingBalanceMinor` и server-confirmed `currentBalanceMinor`, равный starting balance на Этапе 2;
- optional monthly planned amount, target amount и target date;
- active/archive state, display order, optional comment;
- list active/archive envelopes;
- audit create/update/archive;
- default envelope template из функционального ТЗ: `Текущие 10–24`, `Текущие 25–9`, `Обязательные`, `Ремонт`, `Автомобиль`, `Свободные`.

Не реализовывать распределение дохода, расход из конверта, transfer, дефицит, auto-rule шабашки или итоговый расчёт конверта. Для Этапа 2 `currentBalanceMinor` формируется только из начального остатка.

### 5. Инициализация budget defaults

Согласовать в дизайне и реализовать один безопасный вариант:

- при создании **нового** budget создать default categories/envelopes атомарно вместе с budget; либо
- предоставить owner явную отдельную action для инициализации template, идемпотентную по budget.

Ограничения:

- существующие budgets Этапа 1 не менять неявно migration/seed-ом;
- повторный seed не создаёт дубли;
- создание defaults, если выполняется, записывает audit event;
- demo seed остаётся безопасным, не запускается в production и не содержит production credentials.

### 6. API, authorization и OpenAPI

Добавить versioned `/api/v1` endpoints и полные request/response/error schemas для:

- budget settings read/update;
- account list/create/read/update/archive;
- category list/create/read/update/archive;
- envelope list/create/read/update/archive;
- approved default-template initialization action, если выбрана.

Все endpoints:

- используют `SessionAuthGuard`, `OriginGuard` и CSRF для cookie-based mutations;
- проверяют всю цепочку: authenticated user → workspace membership → budget access → role → object belongs to budget → object state;
- ограничивают `budget_id` внутри repository query; не загружать чужие rows для фильтрации в приложении;
- возвращают Problem Details, включая field-level validation errors;
- документированы в OpenAPI с request, response, error schemas и cookie security scheme;
- не делают Prisma calls в controllers.

MVP фактически использует `OWNER`. Модель/policy остаётся готовой к `EDITOR`/`VIEWER`; matrix прав для новых endpoints должна быть явно протестирована.

### 7. Web

Добавить русскоязычные, адаптивные страницы настроек за защищённым `/app`:

- budget settings;
- accounts;
- categories;
- envelopes.

Не нужен полный dashboard или UI операций.

Требования:

- API client продолжает использовать HttpOnly session cookie и memory-only CSRF token; не добавлять auth/financial tokens в `localStorage`;
- loading, empty, error и success states;
- field-level errors;
- keyboard operation, visible focus, labels, non-color-only archive/status, touch-friendly controls;
- money input принимает decimal string, не выполняет финансовую арифметику на client;
- UI не является источником authorization или balance calculation.

Запустить dev server и проверить браузером: owner создаёт/редактирует/архивирует счет, category и envelope; budget settings сохраняются; mobile-width layout usable.

### 8. Тесты

Добавить unit, integration и browser tests минимум для:

- migration на clean DB и существующей DB;
- conversion/validation decimal string → `BIGINT` minor units, включая zero, sign, scale, malformed values и overflow;
- отсутствие float в source of truth;
- account types, `RUB` constraint, initial balance, current balance Этапа 2 и archive state;
- account/category/envelope budget isolation при ID substitution;
- category income/expense type filtering;
- envelope defaults и отсутствие duplicate creation при повторной template action/seed;
- archive behavior;
- OWNER allowed, EDITOR/VIEWER denied mutations according to policy;
- audit events c correct old/new values;
- OpenAPI paths, request/response/error contracts;
- Problem Details validation/authz errors;
- CSRF/Origin protection для новых mutations;
- web settings flow, error rendering и mobile viewport;
- полный CI gate.

## Не включать

- income, expense, transaction ledger, transaction metadata;
- income allocations и правило `Шабашка → Ремонт`;
- transfers/transfer parts;
- cycle calculation, period limits, dashboard totals;
- plans, notifications, worker jobs, analytics, export;
- bank import/integration, external delivery, full multi-currency, credits/debts, collaboration UI, AI, billing, production deployment.

## Финальная проверка

Перед completion выполнить свежие verified commands и зафиксировать результат:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose -f infra/compose/local.yml config --quiet
```

README обновлять только для созданных и проверенных commands. Не commit secrets, raw tokens, passwords, cookies или sensitive payload.
