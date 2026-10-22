# Дашборд: новая раскладка по прототипу Figma Make

**Статус:** дизайн согласован с владельцем 22.10.2026.
**Ветка:** `feat/dashboard-redesign`.
**Источник:** прототип Figma Make владельца (скриншот в сессии 22.10.2026), сверенный с [Calm Fintech visual guidelines](2026-09-17-calm-fintech-visual-guidelines.md). При расхождении прототипа и гайдлайна побеждает гайдлайн.

## Цель

Перестроить главную страницу `apps/web/app/pages/app/index.vue` по прототипу: один главный ответ «Можно потратить» рядом с общей картиной денег, заметные предупреждения, ближайшие платежи со статусом покрытия, прогресс конвертов и операции по дням. Добавить в `GET /api/v2/budgets/{budgetId}/dashboard` три аддитивных поля, без которых прототип пришлось бы досчитывать на клиенте.

Не цель: новые бизнес-правила, модель цели накоплений, изменения других страниц, миграции БД.

## Что меняется на странице

Порядок блоков сверху вниз.

### 1. Шапка

- Kicker (имя workspace) и заголовок (имя бюджета) — как сейчас.
- Новый подзаголовок с иконкой `Calendar`: «10–24 октября · первая половина периода · осталось 3 дня».
  - Диапазон — `period.start`–`period.end` (`Intl.DateTimeFormat('ru-RU')`, месяц один раз, если совпадает).
  - Половина — «первая половина периода», если `period.start === cycle.start`, иначе «вторая половина периода».
  - «осталось N дней» — `periodStats.daysLeft` с текущим склонением из `AvailableBudgetCard`; часть не показывается, когда `periodStats === null`.
- Действия справа без изменений: `AppAddMenu` (от 1024px) и «Обновить данные». Кнопку темы из прототипа не переносим: переключатель темы уже есть в сайдбаре.

### 2. Онбординг и решения периода

`OnboardingChecklist` и `PeriodDecisionCard` остаются над hero без визуальных изменений.

### 3. Hero — одна карточка из двух панелей

От 1280px — `grid-template-columns: minmax(0, 1fr) minmax(24rem, 28rem)` (правка после проверки в браузере 22.10.2026: при `2fr 1fr` подписи «Общей картины» переносились, а на 1024–1279px рядом с сайдбаром левой панели не хватает места), ниже — панели друг под другом. Подписи строк «Общей картины» — `--hf-font-size-small`. В блоке «Внимание» строка без пары занимает всю ширину. Общая рамка карточки по правилу card treatment, правая панель — фон `--hf-color-surface-subtle`, без отдельной рамки.

**Левая панель «Можно потратить»** (компонент `AvailableBudgetCard`):

- Заголовок `h2` «Можно потратить», крупная сумма `spendable.amountMinor`.
- Подпись: «До 24 октября · доступно в текущем конверте».
- Шкала: существующий `FinancialMonthTimeline` — финансовый месяц, граница периодов, метка текущей даты. Процента «N% периода использовано» нет (правка владельца). Компонент получает проп `embedded` — без собственной рамки, фона, тени и внутреннего отступа; логика, подписи и `aria-label` не меняются.
- Три показателя под разделителем: «Потрачено», «Было доступно», «В среднем в день» (`periodStats`).
- Состояния `NEEDS_PERIOD_SETUP`, пустой период, «Превышение периода», `dueMayBeIncomplete` — сохраняются со своими текстами.
- Строка «Не распределено … Распределить» и флаг «Не хватает на обязательные» из hero убираются: их показывает блок «Внимание» (п. 4).

**Правая панель «Общая картина»** (новый компонент `DashboardOverviewPanel`):

| Строка | Значение |
| --- | --- |
| На счетах | `cashMinor` |
| Отложено на платежи и накопления | `protectedMinor` (новое поле) |
| Свободно для текущих трат | `spendable.amountMinor`; при `NEEDS_PERIOD_SETUP` — текст «Лимит не настроен» |

Строки не обязаны складываться в итог и не подаются как уравнение: клиент ничего не вычитает и не суммирует. Под ними — раскрывающийся «Как рассчитано» (`aria-expanded`/`aria-controls`) с существующей детализацией из `AvailableBudgetCard` (переносится как есть) и пояснением «Деньги находятся на счетах. Конверты только показывают их назначение.»

### 4. Внимание

`DashboardWarnings` перестраивается в карточку с сеткой `UiAttentionRow` (`plain`): одна колонка на телефоне, две от 1024px, разделитель между колонками. Заголовок «Требует внимания» остаётся визуально скрытым `h2` для screen reader.

Источники строк:

| Строка | Тон | Заголовок | Описание | Действие |
| --- | --- | --- | --- | --- |
| `MANDATORY_GAP`, `level` ALERT | warning | «Не хватает на обязательные платежи» | `message` сервера | «Покрыть» → `actionPath` |
| `MANDATORY_GAP`, `level` INFO | info | «Заложите на следующий период» | `message` | «Покрыть» → `actionPath` |
| `CASH_SHORTFALL` | danger | «Не хватает денег на счетах» | `message` | «Проверить счета» → `actionPath` |
| `freeToAssignMinor` > 0 (строковая проверка, как сейчас) | info | «Есть нераспределённый доход» | «N ₽ можно направить в конверты» | «Распределить» → `funding.offer({ sourceKind: 'FREE' })` |

`PERIOD`-предупреждения по-прежнему обрабатывает `PeriodDecisionCard`. Блок не рендерится, когда строк нет. Статус передаётся иконкой и текстом, не только цветом.

### 5. Ближайшие обязательные платежи

`UpcomingObligations` — карточка на всю ширину: заголовок `h2` «Ближайшие обязательные платежи», подпись «На ближайшие 60 дней», `UiMoreLink` «Все планы» → `/app/plans`.

Строки — колонки (до 3, `repeat(auto-fit, minmax(16rem, 1fr))`, на телефоне одна колонка) с вертикальными разделителями. Каждая строка — ссылка на `/app/plans?occurrence={id}` целиком (без вложенных интерактивных элементов):

- плитка даты: число крупно, сокращённый месяц снизу; `aria-hidden`, полная дата есть в доступном имени ссылки;
- название и статус покрытия: `COVERED` — `Check` + «Отложено полностью» (success), `PARTIAL` — `CircleAlert` + «Нужно пополнить N ₽» (warning, N = `shortfallMinor`), `UNCOVERED` — `CircleAlert` + «Не отложено» (warning);
- сумма `unpaidMinor` и `ArrowRight` (`aria-hidden`).

Пустое состояние — «Ближайших обязательных платежей нет.»

### 6. Счета и конверты

Две колонки от 1024px, как сейчас. `BalanceList`:

- заголовок `h2` в стиле заголовка карточки (не uppercase-kicker), подпись («Где находятся деньги» / «Для чего назначены деньги»), `UiMoreLink` «Все счета» / «Все конверты»;
- итог (`cashMinor` / `envelopesTotalMinor`) крупно под заголовком;
- строки с разделителями.

Строка конверта получает полосу прогресса под подписью, если `progress !== null`: существующий `UiProgress` (`value = valueMinor`, `max = maxMinor`, `tone = envelopeTone(envelopeType)`) — цвет типа, `role="progressbar"`, `aria-valuenow`. `label`: `SPENT` — «Потрачено из отложенного», `COVERED` — «Покрыто ближайших платежей», `GOAL` — «Цель» (те же подписи, что на странице «Конверты»). Подпись строки:

- `SPENT`, `GOAL` — текущая подпись (`envelopeSubtitle`);
- `COVERED`, `shortfallMinor` ≠ `'0'` — «Нужно пополнить N ₽» цветом warning с иконкой `CircleAlert`;
- `COVERED`, `shortfallMinor` = `'0'` — «Отложено полностью».

Строка «Не распределено» в подвале конвертов убирается (п. 4 показывает её как действие).

### 7. Последние операции

`RecentOperations` группирует последние 5 операций по дню через `OperationGroup`: «Сегодня», «Вчера», иначе дата «20 октября». «Сегодня» определяется по `asOf` дашборда (новый проп), не по часам браузера. Ссылка «Все операции» — `UiMoreLink`. Строки `OperationRow` не меняются.

## Изменения API

Только аддитивные поля в `DashboardV2Response`; существующие поля, их смысл и коды ошибок не меняются. Миграций нет. Всё считается в существующей read-only `RepeatableRead` транзакции `DashboardV2ApplicationService.compute`, в `bigint`, из уже прочитанных строк. Репозиторий только расширяет существующие запросы: колонка `envelope_id` в `upcoming` и `nearestObligations` (оба уже фильтруют `budget_id` и join по `budget_id`) и `targetAmountMinor` в `select` `listEnvelopes` (фильтр `budgetId` не меняется). Расчёт покрытия и прогресса — чистые функции в новом `dashboard-v2-progress.domain.ts` с unit-тестами. Поле `envelopeId` внутренних строк `upcoming` в ответ `upcoming[]` не попадает.

### `protectedMinor: string`

`max(mandatoryBalance, 0) + otherProtected` — деньги, отложенные на обязательные платежи и накопления/прочие конверты вне текущего периода. Отрицательный остаток обязательных не уменьшает сумму.

### `nearestObligations[].coverage` и `nearestObligations[].shortfallMinor`

- `coverage: 'COVERED' | 'PARTIAL' | 'UNCOVERED'`, `shortfallMinor: string` (≥ 0).
- Алгоритм: для каждого обязательного конверта доступно `max(balance конверта, 0)` (balance по всем его периодам, как в `envelopes[]`). Открытые платежи списка в порядке `scheduled_on, id` (тот же порядок, что в запросе) покрываются жадно из доступного остатка своего конверта: `covered = min(remaining, unpaid)`, `remaining -= covered`, `shortfall = unpaid - covered`.
- `COVERED` — `shortfall = 0`; `UNCOVERED` — `covered = 0` и `unpaid > 0`; иначе `PARTIAL`.
- Корректность: `nearestObligations` — префикс полного упорядоченного списка открытых платежей до 60 дней, поэтому все более ранние платежи того же конверта уже в списке, и жадное распределение по списку совпадает с распределением по всему горизонту.

### `envelopes[].progress`

`{ kind: 'SPENT' | 'COVERED' | 'GOAL'; valueMinor: string; maxMinor: string; shortfallMinor: string | null } | null`.

Форма повторяет уже принятый паттерн страницы «Конверты» (`planProgress` + `UiProgress`): сервер отдаёт обе суммы строками minor units, клиент вычисляет только долю для ширины полосы (`progressPercent`), сумм не выводит.

- `SPENT` — только главный конверт текущего периода при `periodStats !== null` и `available > 0`: `valueMinor = spent`, `maxMinor = available` (= `periodStats.availableMinor`); `shortfallMinor = null`.
- `COVERED` — конверт `MANDATORY_EXPENSES` с неоплаченными платежами горизонта этого конверта (`upcoming` до `horizonEnd`, сумма `due > 0`): `valueMinor = max(balance, 0)`, `maxMinor = due`, `shortfallMinor = max(due - max(balance, 0), 0)`.
- `GOAL` — прочие конверты с целью `targetAmountMinor > 0` (`SAVINGS_GOAL`, `RESERVE`, `CUSTOM`): `valueMinor = max(balance, 0)`, `maxMinor = targetAmountMinor`; `shortfallMinor = null`.
- Иначе `null`: конверт второй половины периода, обязательные без платежей горизонта, конверты без цели, `FREE_MONEY`.

### Контракт

- DTO `dashboard-v2.dto.ts`: новые классы `DashboardV2EnvelopeProgressResponse`, поля с `@ApiProperty` и русскими описаниями.
- `openapi.json` перегенерируется `node scripts/openapi/generate.mjs`; `scripts/openapi/check.mjs` в CI должен признать изменение совместимым (только новые поля ответа).
- Фронтовый тип `DashboardV2Response` в `useEnvelopePlanV2.ts` получает новые поля. Демо-данные (`apps/web/app/data/demo-scenario.ts`, `landing-demo.ts`) и тестовые фикстуры, типизированные этим ответом, дополняются правдоподобными значениями, чтобы `typecheck` проходил. Другие потребители типа (`EnvelopesSummary`, `EnvelopesPlanView`, `PeriodDecisionCard`, `OnboardingChecklist`) новые поля не используют и не меняются.

## Финансовая корректность и изоляция

- Клиент не суммирует и не вычитает деньги: все суммы и `shortfallMinor` приходят с сервера. Клиент делает только строковые проверки знака/нуля, как сейчас, и форматирование.
- Новые значения считаются в той же транзакции и том же снимке, что остальной дашборд, поэтому согласованы с `mandatoryGap*` и `otherProtectedMinor`.
- Учитываются только `CONFIRMED` неудалённые платежи (существующий `paid` lateral join).
- Новых запросов нет; два существующих запроса получают колонку `envelope_id` без изменения фильтров `budget_id`.

## Доступность

- Заголовки: `h1` бюджет, `h2` на каждый блок; скрытый `h2` для блока «Внимание».
- Ссылки-строки платежей — одно доступное имя «Гимнастика, 24 октября, 6 000 ₽, отложено полностью».
- Полосы прогресса — `UiProgress` (`role="progressbar"` с подписью); статусы — иконка плюс текст.
- Touch-цели не меньше 2.75rem, видимый focus сохраняется.
- Тёмная тема — существующие токены; новые цвета не вводятся.

## Тестирование

- API, unit (`dashboard-v2-progress.domain.test.ts`): жадное покрытие (COVERED/PARTIAL/UNCOVERED, два платежа одного конверта, два конверта, отрицательный остаток); прогресс SPENT/COVERED/GOAL/null.
- API, integration (`apps/api/test/v2-dashboard.integration.test.ts`): `protectedMinor`; `coverage`/`shortfallMinor` в ответе; `progress` SPENT, COVERED с недостачей, GOAL, `null` для конверта без цели; изоляция — платежи и конверты другого бюджета не влияют на покрытие; OpenAPI-схема содержит новые поля. Существующие точные `toEqual` по `nearestObligations` дополняются новыми полями.
- Web, Vitest: `AvailableBudgetCard` (встроенная шкала, без флагов), `DashboardOverviewPanel` (строки, раскрытие, `NEEDS_PERIOD_SETUP`), `DashboardWarnings` (маппинг четырёх строк, кнопка «Распределить» эмитит событие), `UpcomingObligations` (три статуса, доступное имя), `BalanceList`/строка конверта (progressbar и подписи), `RecentOperations` (группы «Сегодня»/«Вчера»/дата по `asOf`), `FinancialMonthTimeline` (`embedded`), страница `index.test.ts`.
- Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` (API), `node scripts/openapi/generate.mjs` + `node scripts/openapi/check.mjs`. Playwright локально не запускается; E2E — в CI.
- Ручной сценарий для CI/владельца: светлая и тёмная тема, 375px / 768px / 1280px, бюджет с недостачей обязательных и нераспределённым доходом, бюджет без настроенного периода.

## Ревью

По матрице: API (новые поля DTO/OpenAPI), Financial (покрытие и проценты), Security (запросы с `budget_id`), QA, UI/UX, финальное. Коммиты — только после одобрения владельца.
