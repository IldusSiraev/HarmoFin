# Дизайн Этапа 2: справочники и счета HarmoFin

**Дата:** 02.09.2026
**Статус:** согласовано к планированию
**Область:** счета, начальные балансы, категории, конверты, настройки бюджета, базовые серверные балансы, API/OpenAPI, аудит и настройки web

## 1. Цель и границы

Этап 2 добавляет подготовительные финансовые сущности поверх Stage 1: счета, начальные балансы, категории, конверты и настройки бюджета. Пользователь получает защищённые API и русскоязычные страницы настроек, где может создавать, изменять и архивировать эти сущности.

Этап не создаёт таблицы и endpoints для доходов, расходов, операций, allocations, переводов, циклов расчёта, планов, уведомлений, аналитики или внешних интеграций. `currentBalanceMinor` на этом этапе подтверждается сервером и равен начальному значению; реальные изменения баланса появятся на следующих этапах.

Модель сохраняет `budget_id` на каждой финансовой сущности и готовит same-budget references для будущего правила распределения шабашки, но не выполняет allocations.

## 2. Принятые решения

### 2.1. Модули

Используются отдельные API-модули `accounts`, `categories` и `envelopes`, а также существующий `budgets` для настроек. Каждый модуль отделяет controller, DTO/schema, application service, repository, policy и tests. Общими остаются только безопасный money parser/formatter, scope authorization и audit writer. Универсальная таблица справочников не используется.

Контроллеры принимают и возвращают transport DTO. Они не вызывают Prisma и не вычисляют финансовые значения. Репозитории включают `budget_id` и цепочку active membership в запросах. Application services проверяют бизнес-правила и координируют транзакции.

### 2.2. Инициализация шаблона

Добавляется явная идемпотентная action владельца:

`POST /api/v1/budgets/{budgetId}/reference-template`

Migration и обычный seed не изменяют существующие Stage 1 budgets неявно. Action выполняется в одной transaction и создаёт отсутствующие дефолтные категории и конверты. Повторный вызов не создаёт дубли и не восстанавливает сущность, которую владелец архивировал вручную.

Для этого используется immutable `template_key`, уникальный среди non-null keys в пределах бюджета. Display name активных accounts и envelopes уникален без учёта регистра в пределах бюджета; display name активных categories уникален без учёта регистра в пределах бюджета и `category_type`. После архивации то же display name можно использовать снова. Template action считается успешным, если все требуемые template keys уже существуют или были созданы.

Action доступна только OWNER. Она создаёт audit event, содержащий безопасный список созданных или уже существовавших template keys, без финансового request payload.

## 3. Модель данных и ограничения

### 3.1. Общие правила

Новые модели используют UUIDv7, PostgreSQL `uuid`, UTC `timestamptz`, snake_case DB names через Prisma mapping, `created_at` и `updated_at`. Для archive state используются `archived_at`, а физическое удаление не предоставляется.

Деньги хранятся как `BIGINT` minor units с `currency CHAR(3)` и `scale SMALLINT`. В Stage 2 разрешены только `currency = 'RUB'` и `scale = 2`. API принимает суммы decimal strings. Сервер проверяет syntax, знак, scale и диапазон PostgreSQL `BIGINT`, затем преобразует строку напрямую в `bigint`. JavaScript floating-point arithmetic и `number` как источник истины не используются.

Начальные денежные поля допускают zero. Отрицательные значения допускаются только когда у бюджета `allow_negative_balance = true`; это проверяется в application service. PostgreSQL `BIGINT` задаёт допустимый диапазон значений.

### 3.2. `accounts`

Поля:

- `id`, `budget_id`;
- `name`;
- `account_type`: `BANK_ACCOUNT`, `BANK_CARD`, `CASH`;
- nullable `bank_name`;
- nullable `last_four_digits`, только 4 цифры;
- `currency`, `scale`;
- `starting_balance_minor`;
- `accounting_start_date`;
- nullable `comment`;
- nullable `archived_at`;
- `created_at`, `updated_at`.

`currentBalanceMinor` не хранится. API рассчитывает его из `startingBalanceMinor` и возвращает как canonical integer string. В Stage 2 они равны.

### 3.3. `categories`

Поля:

- `id`, `budget_id`;
- `template_key`;
- `name`;
- `category_type`: `INCOME` или `EXPENSE`;
- nullable `parent_id`;
- `display_order`;
- nullable `comment`;
- nullable `archived_at`;
- `created_at`, `updated_at`.

`parent_id` ссылается на активную категорию того же бюджета и того же `category_type`; self-reference и циклы запрещены. Архивную parent category нельзя выбрать. Физическое удаление отсутствует.

### 3.4. `envelopes`

Поля:

- `id`, `budget_id`;
- `template_key`;
- `name`;
- `envelope_type`: `CURRENT_EXPENSES`, `MANDATORY_EXPENSES`, `SAVINGS_GOAL`, `RESERVE`, `FREE_MONEY`, `CUSTOM`;
- `currency`, `scale`;
- `starting_balance_minor`;
- nullable `monthly_planned_amount_minor`;
- nullable `target_amount_minor`;
- nullable `target_date`;
- `display_order`;
- nullable `comment`;
- nullable `archived_at`;
- `created_at`, `updated_at`.

`currentBalanceMinor` вычисляется сервером и равен начальному остатку. Optional planned/target amounts не могут быть отрицательными. `target_date` разрешена только вместе с `target_amount_minor`; target amount без даты разрешён.

### 3.5. Budget settings

В `budgets` добавляются:

- `timezone`, default `Europe/Moscow`;
- `allow_negative_balance` сохраняется и используется для начальных балансов;
- `income_allocation_rule_enabled`;
- nullable `income_allocation_source_category_id`;
- nullable `income_allocation_target_envelope_id`.

Это generic configuration одной будущей автоматической income allocation: source ID ссылается на обычную активную `INCOME` category, target ID — на обычный активный envelope того же бюджета. Ни одна категория, включая шаблонную `Шабашка`, не получает специальный тип или модель. При включённом правиле оба reference ID обязательны; при выключении оба очищаются. Stage 2 не выполняет allocation и не хранит его процент, фиксированную сумму или график. Их модель и поддержка нескольких одновременных правил относятся к финансовым операциям Stage 3.

Для same-budget integrity используются составные foreign keys там, где Prisma и PostgreSQL позволяют это выразить; application service дополнительно выполняет scoped lookup. Новые таблицы получают индексы по `(budget_id, archived_at)`, `(budget_id, category_type, archived_at)` и часто используемым template/reference filters. Partial unique indexes обеспечивают active-name uniqueness: `(budget_id, lower(name))` для accounts/envelopes и `(budget_id, category_type, lower(name))` для categories. Отдельный partial unique index `(budget_id, template_key)` применяется к non-null template keys.

## 4. Бизнес-правила

### 4.1. Accounts

Создание требует name, account type, `RUB`, starting balance и accounting start date. Bank name и last four digits optional; полные реквизиты не принимаются и не хранятся. Archived account остаётся доступен в explicit archived/all list и в истории, но не может использоваться будущей финансовой операцией.

Update разрешает только согласованные editable fields и повторно проверяет budget settings и object state. Archive устанавливает timestamp и audit event; повторное archive безопасно. Read/list всегда scoped по текущему user, workspace membership, budget и object budget.

### 4.2. Categories

CRUD и archive scoped по бюджету. List поддерживает `type=INCOME|EXPENSE` и `status=active|archived|all`. Default income categories:

- `Зарплата`;
- `Шабашка`;
- `Прочий доход`;
- `Кэшбек`;
- `Проценты от вкладов`.

Default expense categories включают категории из функционального ТЗ разделов 8.1–8.2, кроме доходных: `Жена`, `Продукты`, `Ипотека`, `Бензин`, `Секции и кружки`, `Досуг`, `Автосервис`, `Кафе и рестораны`, `Хозтовары`, `Одежда`, `Подписки`, `Коммуналка`, `Аптека`, `Фастфуд`, `Спорт и фитнес`, `Детский сад`, `Клиника`, `Ремонт`, `Досуг детей`, `Красота`, `Такси`, `Подарки`, `Интернет`, `Электроника`, `Мобильная связь`, `Алкоголь`, `Парковка`, `Страховка`, `Образование`, `Путешествия`, `Ремонт/жилье`, `Банковские комиссии`, `Налоги`, `Прочее`.

Повторный template action не создаёт duplicate categories. Archive вместо физического удаления сохраняет историю.

### 4.3. Envelopes

CRUD и archive scoped по бюджету. Default template:

- `Текущие 10–24` — `CURRENT_EXPENSES`;
- `Текущие 25–9` — `CURRENT_EXPENSES`;
- `Обязательные` — `MANDATORY_EXPENSES`;
- `Ремонт` — `SAVINGS_GOAL`;
- `Автомобиль` — `SAVINGS_GOAL`;
- `Свободные` — `FREE_MONEY`.

Archived envelope остаётся видимым в explicit archive mode, но недоступен для будущих новых операций. Этап не выполняет распределение, расходы, переводы, deficit или target progress.

## 5. API и авторизация

### 5.1. Endpoints

Budget settings:

- `GET /api/v1/budgets/{budgetId}` — возвращает budget и Stage 2 settings;
- `PATCH /api/v1/budgets/{budgetId}` — изменяет разрешённые settings, включая name, timezone, cycle values, negative-balance flag и generic income-allocation rule configuration.

Accounts:

- `GET /api/v1/budgets/{budgetId}/accounts?status=active|archived|all`;
- `POST /api/v1/budgets/{budgetId}/accounts`;
- `GET /api/v1/budgets/{budgetId}/accounts/{accountId}`;
- `PATCH /api/v1/budgets/{budgetId}/accounts/{accountId}`;
- `POST /api/v1/budgets/{budgetId}/accounts/{accountId}/archive`.

Categories используют те же CRUD/archive paths с query filters `type` и `status`. Envelopes используют те же paths с query filter `status`.

Template:

- `POST /api/v1/budgets/{budgetId}/reference-template`.

Каждый endpoint имеет Swagger request/response/error schemas, cookie security scheme, status codes и field-level Problem Details contract. Денежные response fields — integer strings; currency и scale возвращаются явно.

### 5.2. Access chain

Каждая операция проверяет authenticated user, active workspace membership, budget access, role, object budget ownership и object state. Repository query включает budget scope и membership predicate до загрузки объекта. Подмена budget/object ID возвращает `404 RESOURCE_NOT_FOUND`; известный member без права mutation получает `403 FORBIDDEN`.

OWNER может читать и изменять Stage 2 entities. EDITOR и VIEWER могут читать доступные данные, но все mutations получают `403`. Архивный budget или workspace не принимает mutations. SessionAuthGuard, OriginGuard и CSRF остаются обязательными для cookie-based mutations.

### 5.3. Transactions и audit

Каждая create/update/archive/template/settings mutation объединяет изменение и audit event в одной transaction. Audit snapshots используют allowlisted old/new fields. Last four digits, request payload целиком, cookie, token, password и лишние комментарии не попадают в logs или audit snapshots. Audit event содержит actor, workspace, budget, entity, action, source и request ID по существующим Stage 1 conventions.

## 6. Web

Добавляются защищённые маршруты:

- `/app/settings`;
- `/app/accounts`;
- `/app/categories`;
- `/app/envelopes`.

Настройки показывают name, timezone, cycle fields, `allow_negative_balance` и generic configuration будущего автоматического распределения дохода: обычную income category-источник и обычный target envelope. Accounts, categories и envelopes показывают active list по умолчанию, explicit archive mode, create/edit forms и archive confirmation. Empty category/envelope state предлагает `Создать базовый шаблон`.

API client продолжает использовать HttpOnly session cookie, in-memory CSRF token и configured Origin. Money inputs хранят decimal strings, не используют финансовую арифметику и не выполняют optimistic balance update. После mutation UI получает или запрашивает server-confirmed DTO.

UI foundation внедряется в первом settings slice: self-hosted Inter, tokens/base styles и только используемые primitives `UiButton`, `UiInput`, `UiSelect`, `UiCard`, `UiStatus`, `UiConfirmDialog`, empty/error/success/toast states, `FinanceMoney`, `FinanceMoneyInput`, `AccountCard`, `EnvelopeCard`. Все labels, statuses и errors русские. Controls имеют минимум `44x44px`, visible focus, keyboard support, labels, `aria-describedby`, field-level errors и non-color-only archive status. На compact width таблицы не обрезаются; используются cards или labelled lists.

## 7. Обработка ошибок

Strict Zod schemas отвергают unknown fields и валидируют:

- обязательные строки и длины;
- account/category/envelope enum values;
- `RUB` и scale;
- decimal string syntax, sign, scale и overflow;
- date и timezone syntax;
- same-budget income-allocation rule references;
- archive/state conflicts;
- target amount/date consistency.

Ошибки возвращаются в существующем Problem Details формате с `code`, безопасным `detail`, `requestId` и `fieldErrors`. Raw SQL, stack trace, internal IDs, secrets и financial payload не показываются в web.

## 8. Тестовая стратегия

### Unit

- decimal string to `BIGINT` conversion для zero, positive/negative sign, scale, malformed values и overflow;
- отсутствие float source of truth;
- account/envelope negative-balance rules;
- enum, archive-state и same-budget reference rules;
- role policy;
- server response mapping и BigInt money formatting.

### Integration/API

- Stage 2 migration на clean DB и поверх существующей Stage 1 schema/data;
- PostgreSQL foreign keys, checks, signed amounts и active-name/template uniqueness;
- settings update и negative-balance permission;
- account/category/envelope CRUD, archive и current balance;
- budget isolation при подмене IDs;
- category type/status filters;
- template defaults, income additions, envelope defaults и повторную action без duplicates;
- owner/editor/viewer matrix;
- audit old/new values;
- Problem Details, CSRF/Origin, OpenAPI paths и schemas;
- отсутствие чувствительных данных в audit/log output.

### Browser

Playwright проверяет owner flow: создание, изменение и архивирование account/category/envelope; сохранение settings; template action и повторный вызов; field errors; archive state; protected routes; desktop и compact viewport. После UI migration повторно проверяется существующий auth flow.

## 9. Migration, seed и verification

Создаётся новая additive migration; первая migration Stage 1 не изменяется. Existing budgets не получают defaults автоматически. Demo seed остаётся production-safe и не создаёт Stage 2 data для существующих production budgets; отдельные integration fixtures вызывают template action явно.

Перед завершением выполняются:

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

Web flow проверяется в запущенном браузере на desktop и mobile-width. README меняется только для реально созданных и проверенных commands.

## 10. Не входит в этап

- income/expense/transfer transactions;
- allocations и реализация правила шабашки;
- cycle calculation и dashboard totals;
- plans, notifications, worker jobs, analytics и export;
- bank integrations/import;
- full multi-currency, credits/debts, collaborative UI, AI, billing и production deployment.
