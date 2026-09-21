# Выбор иконки для категории пользователем — дизайн

**Статус:** согласовано с пользователем 20.09.2026, готово к написанию implementation plan.
**Область:** `apps/api` (Prisma-миграция, category endpoints), `apps/web` (рендер иконок, форма категории).
**Не входит в рамки:** выбор произвольного цвета категории (отдельная задача в будущем), иконки у групп-категорий (родительских категорий без иконки).

## Контекст и проблема

Иконка категории сейчас — жёстко зашитая карта `templateKey → lucide-компонент` в [category-icon.ts](../../../apps/web/app/components/operations/category-icon.ts). Она работает только для категорий базового шаблона (`templateKey !== null`). Любая категория, которую пользователь создал сам, получает generic-стрелку — без возможности выбора.

## Источник истины для иконки

Сейчас в монорепо нет общего пакета для контрактов между `apps/api` и `apps/web` (только `packages/eslint-config` и `packages/tsconfig`) — DTO уже дублируются вручную (см. `CategoryDto` в [useBudgetReferenceData.ts](../../../apps/web/app/composables/useBudgetReferenceData.ts) и `CategoryView` в [category.application.service.ts](../../../apps/api/src/categories/category.application.service.ts)). Каталог иконок дублируется по тому же принципу — без нового shared-пакета ради одного enum.

Ключ иконки — kebab-case имя из `@lucide/vue` (`shopping-cart`, `house`, `car`, ...): самодокументируемо и совпадает с именами файлов пакета.

## Модель данных

- `categories.icon` — новая nullable колонка (`VARCHAR`, не Prisma-enum: список будет расти, и `ALTER TYPE ... ADD VALUE` на каждую новую иконку — лишнее трение). Допустимые значения валидируются на границе API (zod), не на уровне БД.
- Группы (категории с дочерними) всегда `icon = NULL`; UI их не показывает и не даёт выбрать.
- Одна миграция:
  1. `ALTER TABLE categories ADD COLUMN icon VARCHAR(40)`.
  2. `UPDATE categories SET icon = CASE template_key WHEN 'expense-groceries' THEN 'shopping-cart' ... END WHERE template_key IS NOT NULL` — бэкфилл всех существующих категорий (включая только что созданный шаблон) той же иконкой, которая сейчас жёстко смотрит с фронта. Список `CASE` строится 1:1 из текущего `ICONS` в `category-icon.ts`.
  3. Категории без `templateKey` (пользовательские) остаются с `icon = NULL` → рендерятся generic-стрелкой, пока пользователь не выберет иконку сам.

## Каталог иконок

Тот же фиксированный набор (~40 ключей), что уже используется в `category-icon.ts`, плюс несколько нейтральных для кастомных категорий (`wallet`, `tag`, `sparkle`) — набор не расширяется сверх текущего визуального стиля без отдельного решения.

## API-контракт

- `CreateCategoryInput` / `UpdateCategoryInput` / `CategoryDto` (обе копии — API zod-схема и web-тип) получают `icon?: string | null`.
- Zod-схема на бэке валидирует `icon` по allow-list каталога — неизвестный ключ → `400 VALIDATION_FAILED`.
- `category.application.service.ts`:
  - `create`/`update` бросают `invalidReference`, если `icon` задан, а `parentId` пуст (создаётся/остаётся группа).
  - Обратного принудительного поведения нет: если у листовой категории появляется дочерняя (она становится группой), уже сохранённый `icon` не стирается автоматически — фронт для групп его просто не читает и не показывает.
- Аддитивное изменение контракта, `/api/v1` не ломается, OpenAPI пересобирается.

## Создание базового шаблона

`budget.repository.ts`: в данных `DEFAULT_CATEGORIES` у каждого листа добавляется `icon` (тот же ключ, что сейчас закреплён за его `templateKey` в `category-icon.ts`), у групп — `icon: null`. При `createMany` значение пишется в колонку сразу, без похода в фронтовую карту.

## Фронт: рендер и пикер

- `category-icon.ts` меняет форму карты: было `Record<templateKey, Component>`, станет `Record<iconKey, Component>`. `categoryIcon(category)` принимает объект категории и читает `category.icon`, а не `templateKey`; фолбэк — прежняя generic-стрелка (`ArrowDownLeft`/`ArrowUpRight`) при `icon` пустом или неизвестном ключе.
- В [categories.vue](../../../apps/web/app/pages/app/categories.vue), в форме создания/редактирования категории, — новый компонент `CategoryIconPicker.vue`: сетка кнопок-иконок из того же каталога, текущая подсвечена. Показывается только когда в форме выбран `parentId` (категория — лист); при создании/редактировании группы (`parentId` пуст) — скрыт, `icon` в payload не отправляется.
- Пикеры категорий в операциях/планах (`OperationForm`, `AppOperationEntryDialog`, `PlanForm`) не меняются в поведении — они используют `categoryIcon()` косвенно через `category-icon.ts`, теперь по полю `icon` вместо `templateKey`.

## Тестирование

- API integration: zod отклоняет неизвестный `icon` (400); `icon` на группе отклоняется; успешный set/update `icon` на листе; бэкфилл-миграция корректно проставляет `icon` по `template_key` на реальных данных (тест на уже существующих фикстурах шаблона).
- Web component test: `CategoryIconPicker` скрыт для группы, показан и кликабелен для листа; `categoryIcon()` фолбэк на generic-стрелку при `icon: null`.

## Вне рамок

- Произвольный цвет категории — отдельная задача.
- Иконки у групп-категорий.
