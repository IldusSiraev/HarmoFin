# Планы v2: форма «Создать план» — план реализации

- **Дата:** 2026-10-04
- **Дизайн:** [2026-10-04-plan-create-form-design.md](../specs/2026-10-04-plan-create-form-design.md) (утверждается владельцем; не начинать без его одобрения).
- **Исполнитель:** другая сессия, один писатель. Рабочая папка `D:\Projects\playground\family_budget`, ветка `feat/envelope-v22-foundation`, текущий checkout, без worktree.
- **Объём:** только `apps/web`. API, OpenAPI и схема БД не меняются.

## Правила выполнения

- Прочитать до начала: `CLAUDE.md`, `.claude/rules/*`, дизайн выше, [Calm Fintech](../specs/2026-09-17-calm-fintech-visual-guidelines.md), журнал `docs/ux/newcomer-walkthrough.md` (UX-15, UX-16, UX-17).
- TDD: на каждую задачу сначала тест (красный, зафиксировать причину), затем код (зелёный).
- Не запускать Playwright и браузер локально; e2e-сценарий только написать (владелец запускает `pnpm test:e2e`).
- Интеграционные тесты API не нужны (API не меняется). Если всё же понадобятся, только на БД `harmofin_v22_test`, рабочую БД `harmofin` не трогать.
- Не коммитить, не пушить без явного согласия владельца. Коммитить только файлы задачи, `docs/runbooks/budget-reset.sql` и `identity/*` не трогать.
- Деньги в браузере не считать: сумма только проверяется шаблоном и отправляется текстом.
- Тексты интерфейса на русском, идентификаторы на английском.
- Проверки после каждой задачи (из корня): `cd apps/web && pnpm exec vitest run <файлы>`, в конце `pnpm exec vitest run`, `pnpm exec eslint app`, `pnpm typecheck`, `pnpm exec prettier --check <изменённые файлы>`.

## Структура файлов

| Файл | Действие |
| --- | --- |
| `apps/web/app/components/plans/plan-form.ts` | создать: типы, проверка, сборка запроса |
| `apps/web/app/components/plans/plan-form.test.ts` | создать |
| `apps/web/app/components/operations/OperationAmountField.vue` | изменить: необязательный `hideStepper` |
| `apps/web/app/components/operations/OperationAmountField.test.ts` | создать (теста сейчас нет) |
| `apps/web/app/components/plans/PlanCreateDialog.vue` | создать |
| `apps/web/app/components/plans/PlanCreateDialog.test.ts` | создать |
| `apps/web/app/pages/app/plans.vue` | изменить: кнопки, пустые состояния, текст про прогноз, перечитывание, статус |
| `apps/web/app/pages/app/plans.test.ts` | изменить: новые тесты страницы |
| `e2e/envelope-v2-plans.spec.ts` | создать: сценарий для CI, не запускать |
| `docs/ux/newcomer-walkthrough.md` | изменить: статусы UX-15, UX-16 |

Папка `components/plans/` сейчас пуста (v1-компоненты удалены в `bbf25c5`). Образец оформления диалога и вкладок: `apps/web/app/components/app/AppOperationEntryDialog.vue`. Образец ключа идемпотентности: `FundingEntryHost.vue` / `TemplatePreviewSheet.vue`. Образец постоянно смонтированного листа с возвратом фокуса: `ObligationPaySheet` в `plans.vue`.

---

## T01. Чистая логика формы (`plan-form.ts`)

**Тесты (`plan-form.test.ts`), сначала красные:**

1. `validateAmount`: пусто → «Введите сумму…»; `0`, `0,00`, `abc`, `1.234` → ошибка; `100`, `100,5`, `100.50` → принято.
2. Название: пробелы → «Укажите название»; длиннее 120 после обрезки → ошибка.
3. Интервал: при `EVERY_N_MONTHS` обязателен целый 2–120; `1`, `121`, `2.5`, пусто → «Укажите интервал от 2 до 120 месяцев».
4. Дата окончания раньше даты начала → «Дата окончания не может быть раньше даты начала.»; при `ONE_TIME` дата окончания игнорируется.
5. Категория обязательна → «Выберите категорию».
6. `buildCreatePlanRequest`: `MONTHLY` без `intervalMonths` и `endOn`; `ONE_TIME` без `endOn`; `EVERY_N_MONTHS` с числом `intervalMonths`; запятая → точка; необязательные пустые поля (`comment`, `endOn`) не включаются; название обрезается.
7. `fieldErrorsFromProblem(problem)`: сопоставляет серверные `fieldErrors` (`amount`, `name`, `scheduledOn`, `categoryId`, `recurrence`, `intervalMonths`, `endOn`, `comment`) с ключами формы; неизвестные поля — в общую ошибку.

**Реализация:** экспорт `PlanKind = 'obligation' | 'income'`, `PlanFormModel` (`amount`, `name`, `scheduledOn`, `recurrence`, `intervalMonths`, `categoryId`, `endOn`, `comment`), `createPlanForm(today)`, `validatePlanForm(model): Record<string, string>`, `buildCreatePlanRequest(model): CreatePlanRequest`, `fieldErrorsFromProblem`. Тип `CreatePlanRequest` взять из `composables/useEnvelopePlanV2.ts`. Для нормализации суммы использовать `normalizeDecimal` из `composables/useOperationForm.ts`. Никакой арифметики над деньгами.

**Проверка:** `pnpm exec vitest run app/components/plans/plan-form.test.ts`.

## T02. `OperationAmountField`: параметр `hideStepper`

**Тесты (`OperationAmountField.test.ts`, новый файл), красные:**

1. По умолчанию есть кнопки «Увеличить сумму» и «Уменьшить сумму».
2. `hideStepper: true` — кнопок нет, поле и символ валюты на месте, ввод эмитит `update:modelValue`.

**Реализация:** необязательный prop `hideStepper?: boolean` (по умолчанию `false`), `v-if="!hideStepper"` на блок степперов. Существующие места использования не менять.

## T03. `PlanCreateDialog.vue`

Props: `open`, `categories` (массив `CategoryDto`), `pending`, `error`, `fieldErrors`, необязательные `initialKind` (`'obligation'` по умолчанию) и `initialDate`. События: `close`, `submit` (payload `{ kind, request }`). Диалог ничего не вызывает сам: страница делает запрос, держит ключ идемпотентности и статус (как `ObligationPaySheet`).

**Тесты (`PlanCreateDialog.test.ts`), красные:**

1. Вкладки «Платёж» и «Доход» с `role="tab"` и `aria-selected`; `initialKind` выбирает вкладку.
2. Подпись даты: «Ближайший платёж» / «Первое поступление»; кнопка: «Добавить платёж» / «Добавить доход».
3. Подсказка под формой для каждой вкладки (тексты из дизайна §5).
4. Категории фильтруются по типу (`EXPENSE` для платежа, `INCOME` для дохода), архивные скрыты; при смене вкладки выбранная категория сбрасывается, остальные поля сохраняются.
5. Нет категорий нужного типа: вместо выбора видна подсказка про базовый шаблон со ссылкой `/app`, кнопка отправки неактивна.
6. «Раз в несколько месяцев» показывает поле числа месяцев; «Разово» скрывает дату окончания внутри «Дополнительно».
7. Кнопка неактивна без суммы, названия, категории; при `pending` неактивна и показывает загрузку.
8. Отправка: эмитит `submit` с `kind` и `request` из `buildCreatePlanRequest`; при локальной ошибке (сумма 0, интервал 1) событие не эмитится, ошибки у полей, фокус на первом ошибочном поле.
9. Серверные `fieldErrors` и общая `error` (`role="alert"`) показываются, ввод сохраняется.
10. Открытие диалога сбрасывает форму; дата по умолчанию — `initialDate` или сегодня; повторение по умолчанию «Каждый месяц».
11. Доступность: у всех полей подписи, крестик `aria-label="Закрыть"`, Esc закрывает (из `UiModal`).

**Реализация:** на базе `UiModal`, вкладки и крестик в слоте `header` как в `AppOperationEntryDialog.vue`; `OperationAmountField` с `hideStepper` и `accent` (`danger`/`success`); `UiInput`, `UiDatePicker`, `UiPillSelect` (+ поиск категорий и до 15 вариантов, как в форме операции); дополнительные настройки в `<details>`; логика проверки и сборки из `plan-form.ts`. Стили только токенами Calm Fintech, без новых цветов.

**Проверка:** `pnpm exec vitest run app/components/plans`.

## T04. Страница «Планы» (`plans.vue`)

**Тесты (`plans.test.ts`), красные:**

1. В шапке есть кнопка «Добавить платёж»; клик открывает диалог на вкладке «Платёж».
2. Пустой список платежей показывает «Обязательных платежей пока нет…» с подсказкой и кнопкой «Добавить платёж».
3. Блок «Ожидаемые доходы»: при пустом списке видно «Здесь будут ожидаемые поступления.» и кнопку «Добавить доход» (открывает диалог на вкладке «Доход»), строки «Это прогноз…» нет; при непустом списке строка «Это прогноз: пока деньги не пришли…» есть, старого текста «не защищает текущие обязательства» нет нигде.
4. Отправка платежа вызывает `createObligationPlan(budgetId, request, key)`; дохода — `createIncomePlan(...)`; ключ один на повтор той же заявки и новый после изменения полей.
5. Успех: диалог закрывается, списки (`listObligationOccurrences`, `listIncomeOccurrences`) перечитываются, `role="status"`: «Платёж «Аренда» добавлен.» / «Доход «Зарплата» добавлен.», фокус на списке.
6. Ошибка сервера: диалог открыт, введённое сохранено, показана ошибка (поле или общая).
7. Подтверждение, что существующие сценарии (оплата, пропуск, запись дохода, ссылка из уведомления) не сломаны (существующие тесты остаются зелёными).

**Реализация:** подключить `PlanCreateDialog` (постоянно смонтирован), состояние `planDialog`/`planPending`/`planError`/`planFieldErrors`, ключ идемпотентности по образцу `keyFor` в странице, кнопки в слоте `actions` `ReferencePageLayout`, тексты пустых состояний и прогноза по дизайну §8. Категории страница уже загружает (`categories`). Возврат фокуса на вызвавшую кнопку при закрытии без сохранения, на список при успехе.

**Проверка:** `pnpm exec vitest run app/pages/app/plans.test.ts app/components/plans`.

## T05. e2e-сценарий, журнал, финальная проверка

1. `e2e/envelope-v2-plans.spec.ts` по образцу `e2e/envelope-v2-onboarding.spec.ts` и `envelope-v2-payments.spec.ts`: новый бюджет с шаблоном → `/app/plans` → «Добавить платёж» → заполнить (название, сумма, категория расходов, дата) → в списке строка; через API убедиться, что операций нет (план не создаёт расход); дашборд: `onboarding.hasMandatoryPlans === true`; затем «Добавить доход» → плановый доход виден, баланс счетов не изменился. **Не запускать.**
2. `docs/ux/newcomer-walkthrough.md`: UX-15 «сделано частично (SHA): форма создания; календарь UX-17 и правка планов отдельно», UX-16 «сделано (SHA)»; решение владельца: вариант 1 + календарь отдельной задачей.
3. Открытые решения: в `docs/superpowers/plans/2026-10-03-envelope-v2.2-open-decisions.md` §1.3 отметить, что форма создания сделана; правка и остановка плана, календарь остаются.
4. Полные проверки: `cd apps/web && pnpm exec vitest run`, `pnpm exec eslint app`, `pnpm typecheck`, `pnpm exec prettier --check` по изменённым файлам.

## Ревью (после T05, до коммита)

Независимые read-only ревью, каждое по короткому пакету (дизайн, diff, evidence): UI/UX (Calm Fintech, доступность, тексты), QA (покрытие, регрессии, e2e-сценарий), финальное, API-контракт (типы клиента совпадают с `CreateObligationPlanInput` / `CreateIncomePlanInput`: `apps/api/src/obligations/obligation-plan.schemas.ts`, `apps/api/src/plans/income-plan-v2.schemas.ts`), финансовое (форма создаёт план, влияющий на защиту «Можно потратить»: идемпотентность, нет денежной арифметики в браузере). `BLOCK` исправить и повторить затронутое ревью.

## Коммит

Только с согласия владельца, по файлам задачи. Сообщение в стиле репозитория, например: `feat(web): форма создания планов обязательных платежей и доходов`. Журнал UX: SHA проставить вторым небольшим коммитом.

## Промпт для сессии-исполнителя

```
Ты — разработчик HarmoFin (Nuxt 4 / NestJS, модель Envelope Plan v2.2). Работаем в D:\Projects\playground\family_budget, ветка feat/envelope-v22-foundation, текущий checkout, без worktree. Отвечай по-русски, коротко.

Задача: выполнить план docs/superpowers/plans/2026-10-04-plan-create-form.md по дизайну docs/superpowers/specs/2026-10-04-plan-create-form-design.md (форма «Создать план» для обязательных платежей и плановых доходов на странице «Планы»). Убедись, что владелец одобрил дизайн; если нет, остановись и спроси.

Сначала прочитай CLAUDE.md, .claude/rules/*, план и дизайн, docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md, docs/ux/newcomer-walkthrough.md (UX-15, UX-16, UX-17). Выполняй задачи T01–T05 по порядку: TDD (красный → зелёный), один писатель, проверки после каждой задачи. Не запускай Playwright и браузер, не коммить и не пушь без явного согласия владельца, не трогай CLAUDE.md, identity/*, docs/runbooks/budget-reset.sql. Деньги в браузере не считай. После T05 запроси независимые ревью (UI/UX, QA, финальное, API-контракт, финансовое), исправь BLOCK, повтори затронутые ревью, затем коротко доложи владельцу и спроси согласие на коммит.
```
