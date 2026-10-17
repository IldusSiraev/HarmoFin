# Страница аналитики с графиками — дизайн

Дата: 2026-10-17. Область: `apps/web/app/pages/app/analytics.vue` и компоненты `components/analytics`, отчёты `apps/api/src/reports`, OpenAPI. Задача B из раздела 9 [дизайна лендинга v2.2](2026-10-16-landing-v2-2-design.md).

Авторитетные документы: функциональная спецификация (раздел 14.7 «Аналитика»), development-спецификация, [Calm Fintech visual guidelines](2026-09-17-calm-fintech-visual-guidelines.md), [Envelope Plan Model v2.2](<2026-09-29 HarmoFin_Envelope_Plan_Model_v2.2.md>), [глоссарий интерфейса](2026-10-16-ui-glossary-design.md).

## 1. Проблема

- Страница — выпадающий список из 9 отчётов (`REPORT_V2_KEYS`), одна общая горизонтальная bar-диаграмма ECharts (`ReportChart.vue`) и таблица. Диаграмма берёт первое поле `*Minor` строки, поэтому у части отчётов показывает не то число (например, у `net-cash-flow` — доход, а не разницу).
- Нет ответа на главные вопросы пользователя: «как я трачу в этом периоде по сравнению с прошлым», «укладываюсь ли я в лимиты конвертов», «куда уходят деньги».
- Отчёт `plan-vs-actual` — это регулярные планы, не конверты. Отчёта «лимит на период и потрачено по конвертам» нет.
- ECharts нельзя использовать на лендинге (тест `pages/index.build-chunks.test.ts`), а лендинг должен будет показать реальные виды аналитики с демо-данными.

## 2. Решение

1. Страница из пяти вкладок, у каждой — 1–2 понятных графика и текстовый список значений.
2. Графики — собственные presentational SVG-компоненты без ECharts: только props, пригодны для лендинга.
3. Два новых серверных отчёта (`envelope-limits`, `period-comparison`) и поле доли в `expenses-by-category`. Все проценты, разницы и доли считает сервер.
4. `ReportChart.vue`, выпадающий список отчётов и зависимость `echarts` удаляются.

## 3. Структура страницы

- Заголовок: kicker «Аналитика», title «Отчёты бюджета» (`ReferencePageLayout`).
- Вкладки: новый компонент `components/ui/Tabs.vue` (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, переключение стрелками влево/вправо, Home/End, видимый фокус). На ширине до 640px вкладки прокручиваются горизонтально, не переносятся.
- Активная вкладка хранится в `?tab=` (`overview` | `expenses` | `cash-flow` | `envelopes` | `savings`), по умолчанию `overview`. Фильтры — в query как сейчас (`from`, `to`, `accountId`, `categoryId`, `envelopeId`).
- Старые ссылки `?report=<key>` переводятся на вкладку один раз при открытии (`replace`): `account-balances` → `overview`; `expenses-by-category`, `expenses-by-period`, `expenses-by-cycle` → `expenses`; `incomes-by-cycle`, `net-cash-flow`, `plan-vs-actual` → `cash-flow`; `assignment-movements` → `envelopes`; `savings-goals` → `savings`. Неизвестный ключ → `overview`.
- Панель фильтров (`FilterPanel` + `ReportFilters`) общая, но показывает только фильтры, применимые к вкладке (раздел 3.1). Неприменимые значения остаются в URL и не отправляются в запросы этой вкладки.
- Каждая вкладка загружает только свои отчёты (параллельно), при переключении — заново. Состояния: загрузка — `UiSkeleton` в форме карточек; ошибка — текст с `role="alert"` и «Повторить»; пусто — `UiEmptyState` «Нет данных» с подсказкой изменить фильтры или добавить подтверждённые операции. Ошибка одного отчёта не скрывает остальные карточки вкладки.
- Под вкладками — `ExportPanelV2` без изменений.

### 3.1. Вкладки

| Вкладка | Карточки | Отчёты | Фильтры |
|---|---|---|---|
| Обзор | 1) «Текущий период»: потрачено и лимит на период (`UiProgress`), строка сравнения «К этому дню прошлого периода: на 12% меньше (−3 400 ₽)»; 2) «Куда уходят деньги»: топ‑5 категорий периода (`ShareBar` + список) и `UiMoreLink` «Все категории» на вкладку «Расходы»; 3) «На счетах»: остатки счетов списком | `period-comparison`; `expenses-by-category` с `from`/`to` = границы текущего периода из ответа `period-comparison`; `account-balances` | нет (вкладка всегда про текущий период и сегодня) |
| Расходы | 1) «Структура расходов»: `ShareBar` + список всех категорий с суммой и долей; 2) «Расходы по периодам»: `ColumnChart` | `expenses-by-category`, `expenses-by-period` | даты, счёт, конверт |
| Доходы и расходы | 1) «По циклам»: `ColumnChart` с парой столбцов доход/расход на цикл, под каждым циклом — текст «+12 000 ₽» / «−3 000 ₽» (`netCashFlowMinor`); 2) «Регулярные платежи: план и факт»: существующий `PlanVsActualReport` | `net-cash-flow`, `plan-vs-actual` | даты, счёт, категория |
| Конверты | 1) «Лимиты на период»: выбор периода (`UiSelect`, по умолчанию текущий), `LimitBar` на каждый конверт «На текущие траты»; 2) «Распределения и переносы»: существующая таблица (`ReportTable`, `hide-journal`) | `envelope-limits`, `assignment-movements` | даты, конверт |
| Накопления | «Накопления»: `GoalProgress` на каждый конверт «Накопления» — отложено, цель, осталось, срок, «Цель достигнута» | `savings-goals` | конверт, дата «на день» (`to`) |

- Список периодов на вкладке «Конверты» — уникальные `periodStart`/`periodEnd` из строк ответа, новые сверху; текущий — строка с `isCurrent: true`. Выбор периода фильтрует только показ, не пересчитывает суммы.
- Строки категорий и циклов ведут в журнал по `journalFilters`, как сейчас (`ReportTable` уже умеет). Ссылка — текст строки, не SVG.
- Отчёт `expenses-by-cycle` и `incomes-by-cycle` на странице не показываются отдельно: те же числа есть в `net-cash-flow`. Ключи остаются в API и в CSV-выгрузке.
- Тексты — по глоссарию: «Отложено», «Не распределено», «Лимит на период», «Перерасход», типы конвертов «На текущие траты» и «Накопления». Слово «назначение» в смысле раскладывания денег не используется.

## 4. Новые серверные агрегаты

Всё в существующем `GET /api/v2/budgets/{budgetId}/reports/{key}` и `ReportV2ApplicationService`: проверка модели 2, доступ любого активного участника, одна read-only транзакция `REPEATABLE READ`, `budget_id` в каждом запросе, проверка объектов фильтров (`validateReferences`, иначе 404). Новые ключи добавляются в `reportV2Keys` — изменение аддитивное (контроллер версии `v2`), старые ключи и формы строк не меняются. Деньги — `bigint` minor units на сервере и строки `^-?\d+$` в ответе.

### 4.1. `envelope-limits`

Строка на пару (период, конверт) для конвертов `CURRENT_EXPENSES`, включая архивные, если в периоде было движение или период текущий:

| Поле | Тип | Смысл |
|---|---|---|
| `periodId` | uuid | строка `envelope_periods` |
| `periodStart`, `periodEnd` | date | границы периода |
| `isCurrent` | boolean | период содержит сегодня в часовом поясе бюджета |
| `envelopeId`, `envelopeName` | uuid, string | конверт |
| `targetMinor` | string \| null | лимит на период; `null`, если `targetStatus = UNSET` |
| `targetStatus` | `UNSET` \| `DRAFT` \| `CONFIRMED` | состояние лимита |
| `spentMinor` | string | потрачено в периоде |
| `remainingMinor` | string \| null | `target − spent`, может быть отрицательным; `null` без лимита |
| `overspentMinor` | string | `max(spent − target, 0)`; `"0"` без лимита |
| `spentPermille` | number \| null | `spent × 1000 / target`, не ограничен сверху (перерасход > 1000); `null` без лимита или при `target = 0` |

- «Потрачено» — по тому же правилу, что `AssignmentBalanceRepository.allBalances` (страница конвертов и дашборд), чтобы числа совпадали. Реализация переиспользует это правило, а не пишет второй SQL с другим окном трат.
- Фильтры: `from`/`to` — период попадает в ответ, если пересекается с интервалом; без дат — периоды за последние 12 месяцев до сегодня и текущий. `envelopeId` — только этот конверт (не `CURRENT_EXPENSES` → пустой ответ). `accountId` и `categoryId` для этого ключа отклоняются ошибкой валидации 400 с кодом существующего формата.
- Сортировка: `periodStart` по убыванию, затем `envelopeName` (`ru`), затем `envelopeId`.

### 4.2. `period-comparison`

Одна строка о текущем бюджетном периоде:

| Поле | Тип | Смысл |
|---|---|---|
| `asOf` | date | день расчёта: `to`, если передан, иначе сегодня в часовом поясе бюджета |
| `periodStart`, `periodEnd` | date | текущий период |
| `daysElapsed` | number | дней с начала периода по `asOf` включительно |
| `spentMinor` | string | CONFIRMED-расходы с `periodStart` по `asOf` |
| `limitTotalMinor` | string \| null | сумма `targetMinor` текущих периодов конвертов `CURRENT_EXPENSES` с `CONFIRMED` лимитом; `null`, если таких нет |
| `spentOfLimitPermille` | number \| null | `spent × 1000 / limitTotal`; `null`, если лимита нет или он 0 |
| `previousPeriodStart`, `previousPeriodEnd` | date | период, содержащий день перед `periodStart` |
| `previousSameDaySpentMinor` | string | расходы прошлого периода за первые `daysElapsed` дней (не дальше `previousPeriodEnd`) |
| `previousTotalSpentMinor` | string | расходы всего прошлого периода |
| `deltaMinor` | string | `spent − previousSameDaySpent` |
| `deltaBasisPoints` | number \| null | `delta × 10000 / previousSameDaySpent`, округление к нулю; `null`, если `previousSameDaySpent = 0` |

- Границы текущего и прошлого периода — тем же резолвером, что `expenses-by-period` (сохранённые `envelope_periods`, иначе настройки цикла, действовавшие в тот день), чтобы смена настроек цикла не переписывала историю.
- Расходы — CONFIRMED `EXPENSE` всех счетов, удалённые не считаются, правило `facts()`.
- Из фильтров принимается только `to` (день расчёта, как у `account-balances`; нужен для истории и детерминированных тестов). Любой из `from`, `accountId`, `categoryId`, `envelopeId` → 400 `VALIDATION_FAILED`. Интерфейс `to` не передаёт.
- Если `previousSameDaySpent = 0`, интерфейс пишет «В прошлом периоде к этому дню расходов не было» без процента.

### 4.3. Доля в `expenses-by-category`

В строки добавляется `shareBasisPoints: number` — доля категории от суммы расходов ответа, округление к нулю. Сумма долей может быть меньше 10000 из-за округления; интерфейс это не исправляет. Остальные поля и порядок строк не меняются.

### 4.4. Контракт

- DTO в `report-v2.dto.ts`: классы строк и ответов для двух ключей, поле `shareBasisPoints`, `example` на русском где есть тексты. `@ApiParam key` получает новые значения. `openapi.json` перегенерируется.
- Web-типы в `useEnvelopePlanV2.ts`: `REPORT_V2_KEYS` дополняется, добавляются `EnvelopeLimitRowDto`, `PeriodComparisonRowDto`, поле `shareBasisPoints`.
- CSV-выгрузка не меняется.

## 5. Графики

Каталог `apps/web/app/components/analytics/charts/`. Общие правила:

- Только props; без composables, `useAuth`, `$fetch`, `navigateTo`, `window`/`ResizeObserver`, без `echarts`. Разметка SSR детерминирована: `viewBox` и проценты, без измерения DOM.
- Суммы приходят строками minor units. Геометрия (ширина, высота) вычисляется из них в компоненте — это отображение, не расчёт: подписи, доли и разницы берутся только из полей сервера. Для геометрии строки переводятся в `bigint`, отношение — в число только на последнем шаге.
- Форматирование сумм — существующий `components/finance/money-format.ts`.
- Цвет — только из токенов через CSS-переменные, без hex в компонентах. В `tokens.css` добавляются ссылочные токены `--hf-color-chart-1…5` (brand, `primary-bright`, `primary-strong`, `brand-active`, `slate-500`), `--hf-color-chart-rest` (`slate-200`) и `--hf-color-chart-track` (`surface-subtle`); тёмная тема получается через уже переопределённые базовые токены. Danger — только перерасход. Расход по умолчанию не красный.
- Доступность: SVG `aria-hidden="true"`; смысл всегда продублирован видимым текстом рядом (список значений, подписи). Статус не передаётся только цветом: перерасход — текстом «Перерасход 1 200 ₽» и иконкой.
- Каждый компонент — в карточке Calm Fintech (обёртка задаётся страницей, не графиком, чтобы лендинг мог положить график в `LandingShowcase`).

| Компонент | Props | Вид |
|---|---|---|
| `ShareBar` | `items: { id, label, amountMinor, shareBasisPoints }[]`, `highlight?: number` (сколько первых выделять цветом, по умолчанию 5) | одна горизонтальная полоса 100% из сегментов; первые `highlight` — палитра графиков, остальные — `--hf-color-border`; под ней список строк: цветная метка сегмента (декоративная, `aria-hidden`), название, сумма, доля «24%». Иконок категорий нет: строки отчёта их не содержат |
| `ColumnChart` | `columns: { id, label, values: { seriesId, amountMinor }[], caption? }[]`, `series: { id, label, tone }[]` | вертикальные столбцы, 1–2 серии на колонку, общая шкала от 0; легенда текстом; `caption` — подпись под колонкой (например, разница за цикл); при >12 колонках — горизонтальная прокрутка карточки |
| `LimitBar` | `label`, `spentMinor`, `targetMinor \| null`, `overspentMinor`, `remainingMinor \| null`, `targetStatus` | полоса лимита с заполнением «потрачено»; при перерасходе заполнение 100% + метка; без лимита — «Лимит на период не задан» и сумма потраченного без полосы; `DRAFT` — пометка «Лимит не подтверждён» |
| `GoalProgress` | строка `SavingsGoalV2Row` | полоса прогресса по `progressPermille`, «Отложено X из Y», «Осталось Z», срок; при `isReached` — статус «Цель достигнута» (иконка + текст). Заменяет внутреннюю вёрстку `GoalProgressReport.vue` |

`PlanVsActualReport.vue` и `ReportTable.vue` остаются; `GoalProgressReport.vue` переходит на `GoalProgress`. Лендинг (`SavingsReportsSection.vue`) уже использует `GoalProgressReport` с демо-данными — он получает новый вид без правок секции.

## 6. Удаление

- `components/analytics/ReportChart.vue` и его тест.
- Выпадающий список отчётов и `reportOptions` в `analytics.vue`.
- Зависимость `echarts` из `apps/web/package.json`, её записи в `nuxt.config.ts` (`optimizeDeps.include`, `manualChunks`), `pnpm-lock.yaml` обновляется.
- Development-спецификация: строка «Графики | ECharts» и фраза «Для аналитики используется ECharts или совместимая библиотека» заменяются на «собственные SVG-компоненты `components/analytics/charts`; тяжёлая библиотека графиков не используется».
- Тест `pages/index.build-chunks.test.ts` остаётся (защищает лендинг от будущих тяжёлых зависимостей); его комментарий уточняется.

## 7. Тесты

- API unit (`report-v2.application.service`): `envelope-limits` — лимит/без лимита/DRAFT, перерасход (`overspentMinor`, `spentPermille > 1000`), `target = 0`, сортировка, фильтр по не-`CURRENT_EXPENSES` конверту; `period-comparison` — `daysElapsed` длиннее прошлого периода (обрезка по `previousPeriodEnd`), нулевой прошлый период, округление `deltaBasisPoints` к нулю для отрицательной разницы, отсутствие лимитов; `shareBasisPoints` — округление и пустой ответ.
- API integration: изоляция — чужой `budgetId` и объекты фильтров чужого бюджета дают 404; учитываются только CONFIRMED и не удалённые; совпадение `spentMinor` из `envelope-limits` с `EnvelopePeriodDto.spentMinor` для того же периода; смена настроек цикла не меняет границы прошлого периода; запрещённые фильтры → 400; VIEWER читает.
- OpenAPI: `openapi.json` перегенерирован, контрактный тест проходит.
- Web unit: `Tabs` (клавиатура, `aria-*`); каждый график — рендер из props, текст значений, перерасход текстом, отсутствие `echarts` и обращения к `window`; `analytics.vue` — вкладка из `?tab=`, перевод `?report=`, загрузка только отчётов вкладки, фильтры по вкладке, ошибка одного отчёта не скрывает другие, пустые состояния.
- E2E: сценариев аналитики в `e2e/` сейчас нет, новые не добавляются; обновляется только комментарий про echarts в `e2e/playwright.config.ts`. Локальный Playwright не запускается.
- Проверки: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` (и тест чанков лендинга после сборки).

## 8. Ревью

По матрице: Financial (новые агрегаты и округления), Security (изоляция, доступ, 404 на чужие объекты), API (новые ключи, DTO, `openapi.json`), UI/UX (Calm Fintech, доступность, тёмная тема), QA и final review. Миграций нет: backend review по миграциям не требуется.

## 9. Вне объёма

- Витрины аналитики на лендинге — отдельная задача после этой; компоненты раздела 5 к ней готовы.
- Свёртка категорий в родительские, динамика счетов и конвертов линиями, «накопления по циклам».
- Новые фильтры (тип, валюта) и изменения CSV-выгрузки.
