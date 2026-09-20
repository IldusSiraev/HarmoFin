# Пользовательский выбор иконки категории — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю выбирать иконку для своей (или дефолтной) листовой категории вместо жёстко зашитой карты `templateKey → иконка`.

**Architecture:** Новая nullable колонка `categories.icon` (VARCHAR, allow-list на границе API, не Prisma-enum). Одна миграция бэкфиллит `icon` у уже существующих категорий по их `template_key`. `budget.repository.ts` при создании шаблона пишет `icon` в колонку напрямую. Фронт переводит `category-icon.ts` с карты `templateKey → Component` на карту `iconKey → Component` и добавляет `CategoryIconPicker.vue` в форму категории (виден только для листьев, т.е. когда выбран `parentId`).

**Tech Stack:** NestJS/Fastify + Prisma (API), Nuxt 4/Vue 3 + `@lucide/vue` (web), Vitest + Supertest-style `server.inject` (integration), Vitest + `@vue/test-utils` (web component tests).

**Spec:** [docs/superpowers/specs/2026-09-20-custom-category-icons-design.md](../specs/2026-09-20-custom-category-icons-design.md)

## Global Constraints

- Иконки — только фиксированный allow-list (см. каталог ниже), не произвольная строка. Валидация на границе API (zod), не на уровне БД.
- Иконку можно задать только листовой категории (есть `parentId`). Категория-группа (без `parentId`) с непустым `icon` — `400 REFERENCE_INVALID`.
- Cvет категории — вне рамок этой задачи.
- Иконки у групп — вне рамок; группы всегда `icon: null` и не показывают пикер.
- `/api/v1` меняется аддитивно (новое опциональное поле) — без breaking changes.
- UI-текст — на русском. Идентификаторы кода, API, схема БД — на английском.
- Каталог иконок дублируется вручную между `apps/api` (allow-list в zod) и `apps/web` (карта компонентов) — в репозитории нет общего пакета контрактов, DTO уже дублируются так же (см. спеку).

### Каталог иконок (44 ключа, kebab-case = имя компонента в `@lucide/vue`)

```
award, baby, banknote, car, circle-dollar-sign, coffee, credit-card, dumbbell,
ellipsis, fuel, gift, hammer, hand-coins, heart-pulse, house, key-round,
landmark, package, palette, paw-print, percent, pill, plane, repeat, school,
shield-check, shirt, shopping-cart, smartphone, sparkles, spray-can,
square-parking, stethoscope, syringe, tag, ticket, truck, utensils,
volleyball, wallet, wifi, wine, wrench, zap
```

### Соответствие `templateKey → iconKey` (для бэкфилла и данных шаблона)

```
income-advance            hand-coins
income-salary             banknote
income-bonus              award
income-sale               circle-dollar-sign
income-gift               gift
income-cashback           credit-card
income-deposit-interest   percent
income-social             hand-coins
expense-activities        volleyball
expense-alcohol           wine
expense-beauty            heart-pulse
expense-cafes             utensils
expense-car-service       wrench
expense-children-leisure  palette
expense-clinic            stethoscope
expense-clothes           shirt
expense-consumer-loan     credit-card
expense-dental            syringe
expense-electronics       smartphone
expense-fast-food         coffee
expense-food-delivery     truck
expense-fuel              fuel
expense-gifts             gift
expense-groceries         shopping-cart
expense-household         sparkles
expense-cleaning-supplies spray-can
expense-insurance         shield-check
expense-internet          wifi
expense-kindergarten      baby
expense-leisure           ticket
expense-marketplaces      package
expense-mobile            smartphone
expense-mortgage          house
expense-other             ellipsis
expense-parking           square-parking
expense-pets              paw-print
expense-pharmacy          pill
expense-rent              key-round
expense-repair            hammer
expense-school            school
expense-sport             dumbbell
expense-subscriptions     repeat
expense-taxes             landmark
expense-taxi              car
expense-travel            plane
expense-utilities         zap
```

`wallet` и `tag` в каталоге, но не в этой таблице — они не привязаны ни к одному дефолту, доступны только как ручной выбор для кастомных категорий.

---

### Task 1: Prisma-миграция — колонка `icon` + бэкфилл

**Files:**
- Modify: `prisma/schema.prisma` (модель `Category`)
- Create: `prisma/migrations/20260920000000_add_category_icon/migration.sql`
- Test: `apps/api/test/reference-data.integration.test.ts` (новый кейс в конце файла)

**Interfaces:**
- Produces: колонка `categories.icon` (`String?`, `@db.VarChar(40)`) — читается/пишется через Prisma-клиент как `icon: string | null` на объекте `Category`. Все последующие задачи используют это поле.

- [ ] **Step 1: Добавить поле в схему**

В `prisma/schema.prisma` в модели `Category` (сейчас это строки 286-309) добавить `icon` сразу после `comment`:

```prisma
model Category {
  id           String       @id @db.Uuid
  budgetId     String       @map("budget_id") @db.Uuid
  templateKey  String?      @map("template_key") @db.VarChar(80)
  name         String       @db.VarChar(120)
  categoryType CategoryType @map("category_type")
  parentId     String?      @map("parent_id") @db.Uuid
  displayOrder Int          @map("display_order")
  comment      String?      @db.VarChar(500)
  icon         String?      @db.VarChar(40)
  archivedAt   DateTime?    @map("archived_at") @db.Timestamptz(3)
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  ...
}
```

(остальные поля модели — `budget`, `parent`, `children`, `transactions`, `regularPlans`, `occurrenceSnapshots`, `@@unique`, `@@index`, `@@map` — не трогать.)

- [ ] **Step 2: Написать миграцию вручную**

Создать `prisma/migrations/20260920000000_add_category_icon/migration.sql`:

```sql
ALTER TABLE "categories" ADD COLUMN "icon" VARCHAR(40);

UPDATE "categories"
SET "icon" = CASE "template_key"
  WHEN 'income-advance' THEN 'hand-coins'
  WHEN 'income-salary' THEN 'banknote'
  WHEN 'income-bonus' THEN 'award'
  WHEN 'income-sale' THEN 'circle-dollar-sign'
  WHEN 'income-gift' THEN 'gift'
  WHEN 'income-cashback' THEN 'credit-card'
  WHEN 'income-deposit-interest' THEN 'percent'
  WHEN 'income-social' THEN 'hand-coins'
  WHEN 'expense-activities' THEN 'volleyball'
  WHEN 'expense-alcohol' THEN 'wine'
  WHEN 'expense-beauty' THEN 'heart-pulse'
  WHEN 'expense-cafes' THEN 'utensils'
  WHEN 'expense-car-service' THEN 'wrench'
  WHEN 'expense-children-leisure' THEN 'palette'
  WHEN 'expense-clinic' THEN 'stethoscope'
  WHEN 'expense-clothes' THEN 'shirt'
  WHEN 'expense-consumer-loan' THEN 'credit-card'
  WHEN 'expense-dental' THEN 'syringe'
  WHEN 'expense-electronics' THEN 'smartphone'
  WHEN 'expense-fast-food' THEN 'coffee'
  WHEN 'expense-food-delivery' THEN 'truck'
  WHEN 'expense-fuel' THEN 'fuel'
  WHEN 'expense-gifts' THEN 'gift'
  WHEN 'expense-groceries' THEN 'shopping-cart'
  WHEN 'expense-household' THEN 'sparkles'
  WHEN 'expense-cleaning-supplies' THEN 'spray-can'
  WHEN 'expense-insurance' THEN 'shield-check'
  WHEN 'expense-internet' THEN 'wifi'
  WHEN 'expense-kindergarten' THEN 'baby'
  WHEN 'expense-leisure' THEN 'ticket'
  WHEN 'expense-marketplaces' THEN 'package'
  WHEN 'expense-mobile' THEN 'smartphone'
  WHEN 'expense-mortgage' THEN 'house'
  WHEN 'expense-other' THEN 'ellipsis'
  WHEN 'expense-parking' THEN 'square-parking'
  WHEN 'expense-pets' THEN 'paw-print'
  WHEN 'expense-pharmacy' THEN 'pill'
  WHEN 'expense-rent' THEN 'key-round'
  WHEN 'expense-repair' THEN 'hammer'
  WHEN 'expense-school' THEN 'school'
  WHEN 'expense-sport' THEN 'dumbbell'
  WHEN 'expense-subscriptions' THEN 'repeat'
  WHEN 'expense-taxes' THEN 'landmark'
  WHEN 'expense-taxi' THEN 'car'
  WHEN 'expense-travel' THEN 'plane'
  WHEN 'expense-utilities' THEN 'zap'
END
WHERE "template_key" IS NOT NULL;
```

Ключи, не перечисленные в `CASE` (группы: `income-group-salary`, `income-group-other`, `expense-group-*`), останутся с `icon = NULL` — это ожидаемо, у групп иконки нет.

- [ ] **Step 3: Применить миграцию и перегенерировать клиент**

```bash
pnpm db:migrate:dev
pnpm db:generate
```

Ожидаемо: миграция применяется без ошибок, `apps/api/node_modules/.prisma/client` (через общий `node_modules/.prisma`) содержит поле `icon` на модели `Category`.

- [ ] **Step 4: Написать integration-тест на то, что колонка принимает и хранит значение**

Добавить в конец `describe('reference template API', ...)` в `apps/api/test/reference-data.integration.test.ts` (после теста `'adopts a pre-existing category or envelope...'`, перед закрывающей `});` блока `describe`):

```ts
  it('persists an icon value directly on the category row', async () => {
    const created = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        name: `Иконка-тест ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 999,
        icon: 'shopping-cart',
      },
    });
    expect(created.icon).toBe('shopping-cart');

    const withoutIcon = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        name: `Без иконки-тест ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 998,
      },
    });
    expect(withoutIcon.icon).toBeNull();
  });
```

- [ ] **Step 5: Прогнать тест**

Run: `pnpm --filter @harmofin/api test:integration -- -t "persists an icon value"`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20260920000000_add_category_icon apps/api/test/reference-data.integration.test.ts
git commit -m "feat(db): add nullable icon column to categories with backfill"
```

---

### Task 2: API-контракт — валидация, репозиторий, application service

**Files:**
- Modify: `apps/api/src/categories/category.schemas.ts`
- Modify: `apps/api/src/categories/category.repository.ts`
- Modify: `apps/api/src/categories/category.application.service.ts`
- Modify: `apps/api/src/categories/category.dto.ts`
- Test: `apps/api/test/reference-data.integration.test.ts`

**Interfaces:**
- Consumes: колонка `categories.icon` из Task 1.
- Produces: `CreateCategoryInput.icon?: string | null`, `UpdateCategoryInput.icon?: string | null`, `CategoryView.icon: string | null` — используются web-клиентом (Task 4) как форма ответа API.

- [ ] **Step 1: Написать падающий integration-тест на валидацию иконки**

Добавить в `apps/api/test/reference-data.integration.test.ts`, в `describe('reference template API', ...)`, сразу после теста `'creates, updates, archives and scopes categories'` (после строки, где заканчивается этот `it(...)`, ищи закрывающую `});` этого теста — вставить новый `it` сразу за ней):

```ts
  it('validates and enforces leaf-only icon assignment', async () => {
    const unknownIcon = await createCategory({
      name: `Неизвестная иконка ${randomUUID()}`,
      icon: 'not-a-real-icon',
    });
    expect(unknownIcon.statusCode).toBe(400);
    expect(unknownIcon.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const groupWithIcon = await createCategory({
      name: `Группа с иконкой ${randomUUID()}`,
      icon: 'shopping-cart',
    });
    expect(groupWithIcon.statusCode).toBe(400);
    expect(groupWithIcon.json()).toMatchObject({ code: 'REFERENCE_INVALID' });

    const parent = await createCategory({ name: `Родитель для иконки ${randomUUID()}` });
    const parentCategory = parent.json<{ id: string }>();

    const leafWithIcon = await createCategory({
      name: `Лист с иконкой ${randomUUID()}`,
      parentId: parentCategory.id,
      icon: 'shopping-cart',
    });
    expect(leafWithIcon.statusCode).toBe(201);
    expect(leafWithIcon.json()).toMatchObject({ icon: 'shopping-cart' });

    const leafCategory = leafWithIcon.json<{ id: string }>();
    const updated = await updateCategory(leafCategory.id, { icon: 'wallet' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ icon: 'wallet' });

    const clearIcon = await updateCategory(leafCategory.id, { icon: null });
    expect(clearIcon.statusCode).toBe(200);
    expect(clearIcon.json()).toMatchObject({ icon: null });

    const reparentToGroupWithIcon = await updateCategory(parentCategory.id, {
      icon: 'wallet',
    });
    expect(reparentToGroupWithIcon.statusCode).toBe(400);
    expect(reparentToGroupWithIcon.json()).toMatchObject({ code: 'REFERENCE_INVALID' });
  });
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `pnpm --filter @harmofin/api test:integration -- -t "validates and enforces leaf-only icon"`
Expected: FAIL — `icon` сейчас отклоняется схемой `.strict()` как неизвестное поле (400 `VALIDATION_FAILED` уже на первом же успешном кейсе `leafWithIcon`, где мы ждём 201).

- [ ] **Step 3: Добавить `icon` и allow-list в zod-схемы**

В `apps/api/src/categories/category.schemas.ts` заменить весь файл на:

```ts
import { z } from 'zod';

// Mirrors CATEGORY_ICON_KEYS in apps/web/app/components/operations/category-icon.ts — keep both in sync.
const CATEGORY_ICON_KEYS = [
  'award', 'baby', 'banknote', 'car', 'circle-dollar-sign', 'coffee', 'credit-card', 'dumbbell',
  'ellipsis', 'fuel', 'gift', 'hammer', 'hand-coins', 'heart-pulse', 'house', 'key-round',
  'landmark', 'package', 'palette', 'paw-print', 'percent', 'pill', 'plane', 'repeat', 'school',
  'shield-check', 'shirt', 'shopping-cart', 'smartphone', 'sparkles', 'spray-can',
  'square-parking', 'stethoscope', 'syringe', 'tag', 'ticket', 'truck', 'utensils',
  'volleyball', 'wallet', 'wifi', 'wine', 'wrench', 'zap',
] as const;

const categoryFields = {
  name: z.string().trim().min(1).max(120),
  categoryType: z.enum(['INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
  icon: z.enum(CATEGORY_ICON_KEYS).nullable().optional(),
};

export const createCategorySchema = z.object(categoryFields).strict();

export const updateCategorySchema = z
  .object({
    name: categoryFields.name.optional(),
    parentId: categoryFields.parentId,
    displayOrder: categoryFields.displayOrder.optional(),
    comment: categoryFields.comment,
    icon: categoryFields.icon,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listCategoriesSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    sort: z.enum(['default', 'popular']).default('default'),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;
export type ListCategoriesInput = z.output<typeof listCategoriesSchema>;
```

- [ ] **Step 4: Прогнать тест — ожидаем новый провал дальше по сценарию**

Run: `pnpm --filter @harmofin/api test:integration -- -t "validates and enforces leaf-only icon"`
Expected: FAIL — `unknownIcon` теперь корректно 400, но `groupWithIcon` ещё не отклоняется (нет бизнес-правила), а `leafWithIcon`/`updated` ещё не возвращают `icon` в ответе (репозиторий и сервис его не читают/не пишут).

- [ ] **Step 5: Прокинуть `icon` через репозиторий**

В `apps/api/src/categories/category.repository.ts`:

Добавить `icon: string | null;` в `CategoryRecord` (после `comment: string | null;`):

```ts
export interface CategoryRecord {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
  archivedAt: Date | null;
}
```

Добавить `icon: string | null;` в `CategoryCreateData` (после `comment`):

```ts
export interface CategoryCreateData {
  budgetId: string;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
}
```

Добавить `icon?: string | null;` в `CategoryUpdateData` (после `comment?: string | null;`):

```ts
export interface CategoryUpdateData {
  name?: string;
  parentId?: string | null;
  displayOrder?: number;
  comment?: string | null;
  icon?: string | null;
}
```

В `categorySelect` (в самом низу файла) добавить `icon: true,` после `comment: true,`:

```ts
const categorySelect = {
  id: true,
  budgetId: true,
  templateKey: true,
  name: true,
  categoryType: true,
  parentId: true,
  displayOrder: true,
  comment: true,
  icon: true,
  archivedAt: true,
} as const;
```

`create`/`update` уже пишут `data: { id: createUuidV7(), ...input }` и `data: input` — новое поле пройдёт сквозь них без дополнительных правок кода.

- [ ] **Step 6: Прокинуть `icon` и добавить правило «только у листа» в application service**

В `apps/api/src/categories/category.application.service.ts`:

Добавить `icon: string | null;` в `CategoryView` (после `comment: string | null;`):

```ts
export interface CategoryView {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  categoryType: 'INCOME' | 'EXPENSE';
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
  archivedAt: string | null;
}
```

Заменить метод `create` на:

```ts
  async create(
    userId: string,
    budgetId: string,
    input: CreateCategoryInput,
    requestId?: string,
  ): Promise<CategoryView> {
    await this.requireOwnerBudget(userId, budgetId);
    await this.validateParent(userId, budgetId, input.categoryType, input.parentId ?? null);
    if (!input.parentId && input.icon) throw invalidReference();
    const category = await this.repository.create(
      userId,
      {
        budgetId,
        name: input.name,
        categoryType: input.categoryType,
        parentId: input.parentId ?? null,
        displayOrder: input.displayOrder,
        comment: input.comment ?? null,
        icon: input.icon ?? null,
      },
      requestId,
    );
    if (!category) throw resourceNotFound();
    return this.toView(category);
  }
```

Заменить метод `update` на:

```ts
  async update(
    userId: string,
    budgetId: string,
    categoryId: string,
    input: UpdateCategoryInput,
    requestId?: string,
  ): Promise<CategoryView> {
    await this.requireOwnerBudget(userId, budgetId);
    const current = await this.repository.find(userId, budgetId, categoryId);
    if (!current || current.archivedAt) throw resourceNotFound();

    if (input.parentId !== undefined) {
      await this.validateParent(userId, budgetId, current.categoryType, input.parentId, categoryId);
    }
    const resolvedParentId = input.parentId !== undefined ? input.parentId : current.parentId;
    const resolvedIcon = input.icon !== undefined ? input.icon : current.icon;
    if (!resolvedParentId && resolvedIcon) throw invalidReference();

    const category = await this.repository.update(
      userId,
      budgetId,
      categoryId,
      updateData(input),
      requestId,
    );
    if (!category) throw resourceNotFound();
    return this.toView(category);
  }
```

Заменить `toView` на:

```ts
  toView(category: CategoryRecord): CategoryView {
    return {
      id: category.id,
      budgetId: category.budgetId,
      templateKey: category.templateKey,
      name: category.name,
      categoryType: category.categoryType,
      parentId: category.parentId,
      displayOrder: category.displayOrder,
      comment: category.comment,
      icon: category.icon,
      archivedAt: category.archivedAt?.toISOString() ?? null,
    };
  }
```

Заменить функцию `updateData` (внизу файла) на:

```ts
function updateData(input: UpdateCategoryInput): CategoryUpdateData {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
  };
}
```

- [ ] **Step 7: Добавить `icon` в Swagger DTO**

В `apps/api/src/categories/category.dto.ts` добавить в `CreateCategoryRequest` (после `comment`):

```ts
  @ApiProperty({ type: String, nullable: true, required: false, description: 'One of the fixed category-icon keys.' })
  icon?: string | null;
```

То же самое (идентичный блок) — в `UpdateCategoryRequest` и в `CategoryResponse` (в `CategoryResponse` — без `required: false`, т.к. это поле ответа: `@ApiProperty({ type: String, nullable: true }) icon!: string | null;`).

- [ ] **Step 8: Прогнать тест — ожидаем полный проход**

Run: `pnpm --filter @harmofin/api test:integration -- -t "validates and enforces leaf-only icon"`
Expected: PASS.

- [ ] **Step 9: Прогнать весь integration-набор категорий/шаблона, чтобы не сломать остальное**

Run: `pnpm --filter @harmofin/api test:integration`
Expected: все тесты PASS (в т.ч. `creates, updates, archives and scopes categories`, `creates exact defaults...`).

- [ ] **Step 10: Typecheck и lint**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: без ошибок.

- [ ] **Step 11: Коммит**

```bash
git add apps/api/src/categories apps/api/test/reference-data.integration.test.ts
git commit -m "feat(api): validate category icon and restrict it to leaf categories"
```

---

### Task 3: Базовый шаблон пишет `icon` напрямую

**Files:**
- Modify: `apps/api/src/budgets/budget.repository.ts`
- Test: `apps/api/test/reference-data.integration.test.ts`

**Interfaces:**
- Consumes: `icon: string | null` из `CategoryCreateData` (Task 2, но здесь используется напрямую через `tx.category.createMany`, не через репозиторий категорий).
- Produces: каждая листовая категория дефолтного шаблона имеет `icon`, соответствующий таблице из раздела «Каталог иконок» выше; каждая группа — `icon: null`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `apps/api/test/reference-data.integration.test.ts`, сразу после теста `'creates exact defaults and a safe template audit event'` (после его закрывающей `});`):

```ts
  it('assigns an icon to every default leaf category and none to groups', async () => {
    const groceries = await prisma.category.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'expense-groceries' },
    });
    expect(groceries.icon).toBe('shopping-cart');

    const salaryGroup = await prisma.category.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'income-group-salary' },
    });
    expect(salaryGroup.icon).toBeNull();

    // Scoped to templateKey (default) rows only — other tests in this shared-budget
    // file create their own custom child categories with no icon, which is legitimate
    // and must not be flagged here.
    const templateLeavesWithoutIcon = await prisma.category.count({
      where: {
        budgetId: ownerBudgetId,
        templateKey: { not: null },
        parentId: { not: null },
        icon: null,
      },
    });
    expect(templateLeavesWithoutIcon).toBe(0);
  });
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `pnpm --filter @harmofin/api test:integration -- -t "assigns an icon to every default leaf"`
Expected: FAIL — `groceries.icon` сейчас `null` (шаблон ещё не пишет `icon`).

- [ ] **Step 3: Добавить `icon` в данные шаблона**

В `apps/api/src/budgets/budget.repository.ts`:

Заменить тип `DefaultCategory` и `CategoryLeaf`:

```ts
interface DefaultCategory {
  templateKey: string;
  name: string;
  categoryType: CategoryType;
  parentTemplateKey: string | null;
  comment: string | null;
  icon: string | null;
  displayOrder: number;
}
```

```ts
interface CategoryLeaf {
  templateKey: string;
  name: string;
  icon: string;
  comment?: string;
}
```

Заменить `INCOME_CATEGORY_GROUPS` и `EXPENSE_CATEGORY_GROUPS`, переведя каждый элемент `children` из кортежа `[templateKey, name, comment?]` в объект `{ templateKey, name, icon, comment? }` — полный новый блок (заменяет текущие `INCOME_CATEGORY_GROUPS`, `EXPENSE_CATEGORY_GROUPS`, `EXPENSE_STANDALONE_CATEGORIES`):

```ts
// Keys mirror apps/web/app/components/operations/category-icon.ts — update both together.
const INCOME_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'income-group-salary',
    name: 'Зарплата',
    children: [
      { templateKey: 'income-advance', name: 'Аванс', icon: 'hand-coins', comment: 'аванс, часть зарплаты, предоплата' },
      { templateKey: 'income-salary', name: 'Расчёт', icon: 'banknote', comment: 'зарплата, расчёт, оклад' },
      { templateKey: 'income-bonus', name: 'Премия', icon: 'award', comment: 'премия, бонус, bonus' },
    ],
  },
  {
    templateKey: 'income-group-other',
    name: 'Прочий доход',
    children: [
      { templateKey: 'income-sale', name: 'Продажа', icon: 'circle-dollar-sign', comment: 'продажа личных вещей' },
      { templateKey: 'income-gift', name: 'Подарок', icon: 'gift', comment: 'подарок, наследство' },
      { templateKey: 'income-cashback', name: 'Кэшбэк', icon: 'credit-card', comment: 'кэшбэк, cashback, возврат' },
      { templateKey: 'income-deposit-interest', name: 'Проценты по вкладам', icon: 'percent', comment: 'проценты, вклад, депозит' },
      { templateKey: 'income-social', name: 'Социальные выплаты', icon: 'hand-coins', comment: 'пособия, выплаты, пенсия' },
    ],
  },
];

const EXPENSE_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'expense-group-housing',
    name: 'Жилье',
    children: [
      { templateKey: 'expense-mortgage', name: 'Ипотека', icon: 'house', comment: 'ипотека, кредит на жильё, ипотечный платёж, mortgage' },
      { templateKey: 'expense-rent', name: 'Аренда', icon: 'key-round', comment: 'аренда, аренда квартиры, съём, rent' },
      { templateKey: 'expense-utilities', name: 'Коммуналка', icon: 'zap', comment: 'коммуналка, жкх, квартплата, свет, газ, вода, отопление, utilities' },
    ],
  },
  {
    templateKey: 'expense-group-credit',
    name: 'Кредиты',
    children: [
      { templateKey: 'expense-consumer-loan', name: 'Потребительский кредит', icon: 'credit-card', comment: 'кредит, потребительский, займ' },
      { templateKey: 'expense-insurance', name: 'Страхование', icon: 'shield-check', comment: 'страховка, залог, страхование жизни, insurance' },
      { templateKey: 'expense-taxes', name: 'Налоги', icon: 'landmark', comment: 'налог, налоги, пени, налог на имущество, tax' },
    ],
  },
  {
    templateKey: 'expense-group-communication',
    name: 'Связь',
    children: [
      { templateKey: 'expense-internet', name: 'Интернет', icon: 'wifi', comment: 'интернет, wifi' },
      { templateKey: 'expense-mobile', name: 'Мобильная связь', icon: 'smartphone', comment: 'связь, мобильный, сотовый' },
    ],
  },
  {
    templateKey: 'expense-group-food',
    name: 'Еда',
    children: [
      { templateKey: 'expense-fast-food', name: 'Фастфуд', icon: 'coffee', comment: 'мак, kfc, ростикс, шаурма, бургер' },
      { templateKey: 'expense-groceries', name: 'Продукты', icon: 'shopping-cart', comment: 'продукты, магазин, супермаркет, продукты питания, маркет, гипермаркет, grocery' },
      { templateKey: 'expense-cafes', name: 'Кафе и рестораны', icon: 'utensils', comment: 'кафе, ресторан, обед, ужин, cafe' },
      { templateKey: 'expense-food-delivery', name: 'Доставка еды', icon: 'truck', comment: 'доставка, еда, самокат, delivery' },
      { templateKey: 'expense-alcohol', name: 'Алкоголь', icon: 'wine', comment: 'алкоголь, вино, пиво, крепкое' },
    ],
  },
  {
    templateKey: 'expense-group-transport',
    name: 'Транспорт',
    children: [
      { templateKey: 'expense-taxi', name: 'Такси', icon: 'car', comment: 'такси, uber, yandex go' },
      { templateKey: 'expense-fuel', name: 'Бензин', icon: 'fuel', comment: 'бензин, заправка, дизель, азс' },
      { templateKey: 'expense-parking', name: 'Парковка', icon: 'square-parking', comment: 'парковка, паркинг, стоянка' },
      { templateKey: 'expense-car-service', name: 'Автосервис', icon: 'wrench', comment: 'автозапчасти, ремонт авто, шиномонтаж, замена масла, то' },
    ],
  },
  {
    templateKey: 'expense-group-health',
    name: 'Здоровье',
    children: [
      { templateKey: 'expense-clinic', name: 'Клиника', icon: 'stethoscope', comment: 'клиника, поликлиника' },
      { templateKey: 'expense-pharmacy', name: 'Аптека', icon: 'pill', comment: 'аптека, лекарства, таблетки, медикаменты' },
      { templateKey: 'expense-dental', name: 'Стоматология', icon: 'syringe', comment: 'стоматолог, зубы, dental' },
      { templateKey: 'expense-beauty', name: 'Красота', icon: 'heart-pulse', comment: 'красота, спа, парикмахерская, косметика, ногти, массаж' },
      { templateKey: 'expense-sport', name: 'Спорт и фитнес', icon: 'dumbbell', comment: 'спорт, фитнес, спортзал, зал, бассейн' },
    ],
  },
  {
    templateKey: 'expense-group-shopping',
    name: 'Покупки',
    children: [
      { templateKey: 'expense-clothes', name: 'Одежда', icon: 'shirt', comment: 'одежда, обувь, платье, clothes, shoes' },
      { templateKey: 'expense-marketplaces', name: 'Маркетплейсы', icon: 'package', comment: 'маркетплейсы, вайлдберриз, озон, алиэкспресс, wildberries' },
      { templateKey: 'expense-electronics', name: 'Электроника', icon: 'smartphone', comment: 'электроника, техника, телефон, ноутбук, компьютер, gadgets' },
    ],
  },
  {
    templateKey: 'expense-group-entertainment',
    name: 'Развлечения',
    children: [
      { templateKey: 'expense-leisure', name: 'Досуг', icon: 'ticket', comment: 'кино, боулинг, парк' },
      { templateKey: 'expense-children-leisure', name: 'Досуг детей', icon: 'palette', comment: 'игровые, аттракционы' },
      { templateKey: 'expense-subscriptions', name: 'Подписки', icon: 'repeat', comment: 'netflix, spotify, youtube, кинопоиск, подписка' },
      { templateKey: 'expense-travel', name: 'Путешествия', icon: 'plane', comment: 'путешествия, отпуск, отель, тур, поездка, авиабилеты, travel' },
      { templateKey: 'expense-gifts', name: 'Подарки', icon: 'gift', comment: 'подарки, сюрприз' },
    ],
  },
  {
    templateKey: 'expense-group-kids',
    name: 'Дети',
    children: [
      { templateKey: 'expense-kindergarten', name: 'Детский сад', icon: 'baby', comment: 'детский сад, ясли, дошкольное' },
      { templateKey: 'expense-school', name: 'Школа', icon: 'school', comment: 'школа, учебники, форма, канцелярия' },
      { templateKey: 'expense-activities', name: 'Секции и кружки', icon: 'dumbbell', comment: 'секции, кружки, репетитор' },
    ],
  },
  {
    templateKey: 'expense-group-home',
    name: 'Дом',
    children: [
      { templateKey: 'expense-household', name: 'Хозтовары', icon: 'sparkles', comment: 'хозтовары, посуда, мебель, интерьер' },
      { templateKey: 'expense-repair', name: 'Ремонт', icon: 'hammer', comment: 'ремонт, стройка, инструменты, отделка' },
      { templateKey: 'expense-pets', name: 'Питомцы', icon: 'paw-print', comment: 'питомцы, животные, собака, кошка, ветеринар' },
      { templateKey: 'expense-cleaning-supplies', name: 'Бытовая химия', icon: 'spray-can', comment: 'бытовая химия, чистящие средства, порошок' },
    ],
  },
];

const EXPENSE_STANDALONE_CATEGORIES: readonly CategoryLeaf[] = [
  { templateKey: 'expense-other', name: 'Прочее', icon: 'ellipsis' },
];
```

Заменить `CategoryGroup` (интерфейс над этими константами) на:

```ts
interface CategoryGroup {
  templateKey: string;
  name: string;
  children: readonly CategoryLeaf[];
}
```

Заменить `buildDefaultCategories`:

```ts
function buildDefaultCategories(): DefaultCategory[] {
  const rows: DefaultCategory[] = [];
  let order = 0;
  const push = (
    templateKey: string,
    name: string,
    categoryType: CategoryType,
    parentTemplateKey: string | null,
    comment: string | null,
    icon: string | null,
  ) => {
    rows.push({
      templateKey,
      name,
      categoryType,
      parentTemplateKey,
      comment,
      icon,
      displayOrder: order++,
    });
  };
  for (const group of INCOME_CATEGORY_GROUPS) {
    push(group.templateKey, group.name, CategoryType.INCOME, null, null, null);
    for (const leaf of group.children) {
      push(
        leaf.templateKey,
        leaf.name,
        CategoryType.INCOME,
        group.templateKey,
        leaf.comment ?? null,
        leaf.icon,
      );
    }
  }
  for (const group of EXPENSE_CATEGORY_GROUPS) {
    push(group.templateKey, group.name, CategoryType.EXPENSE, null, null, null);
    for (const leaf of group.children) {
      push(
        leaf.templateKey,
        leaf.name,
        CategoryType.EXPENSE,
        group.templateKey,
        leaf.comment ?? null,
        leaf.icon,
      );
    }
  }
  for (const leaf of EXPENSE_STANDALONE_CATEGORIES) {
    push(leaf.templateKey, leaf.name, CategoryType.EXPENSE, null, leaf.comment ?? null, leaf.icon);
  }
  return rows;
}
```

В `initializeReferenceTemplate`, в блоке `tx.category.createMany`, добавить `icon` в объект данных (после `comment: category.comment,`):

```ts
      if (categoriesToCreate.length > 0) {
        await tx.category.createMany({
          data: categoriesToCreate.map((category) => ({
            id: generatedCategoryIdByKey.get(category.templateKey)!,
            budgetId,
            templateKey: category.templateKey,
            name: category.name,
            categoryType: category.categoryType,
            parentId: category.parentTemplateKey
              ? (categoryIdByKey.get(category.parentTemplateKey) ?? null)
              : null,
            displayOrder: category.displayOrder,
            comment: category.comment,
            icon: category.icon,
          })),
        });
      }
```

- [ ] **Step 4: Прогнать тест**

Run: `pnpm --filter @harmofin/api test:integration -- -t "assigns an icon to every default leaf"`
Expected: PASS.

- [ ] **Step 5: Прогнать весь набор reference-data + typecheck**

Run: `pnpm --filter @harmofin/api test:integration && pnpm --filter @harmofin/api typecheck`
Expected: всё PASS (включая тест числа категорий `toHaveLength(58)` — количество строк не меняется, добавляется только поле).

- [ ] **Step 6: Prettier**

Run: `npx prettier --write apps/api/src/budgets/budget.repository.ts`

- [ ] **Step 7: Коммит**

```bash
git add apps/api/src/budgets/budget.repository.ts apps/api/test/reference-data.integration.test.ts
git commit -m "feat(api): assign icon keys to default template categories"
```

---

### Task 4: Web-контракты и каталог иконок

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/components/operations/category-icon.ts`
- Modify: `apps/web/app/components/operations/category-icon.test.ts`
- Modify: `apps/web/app/pages/app/categories.vue` (только вызов `categoryIcon`)
- Modify: `apps/web/app/pages/app/operations.vue` (только вызов/проп)
- Modify: `apps/web/app/components/operations/OperationRow.vue`
- Modify: `apps/web/app/components/operations/OperationRow.test.ts` (если ссылается на старый проп — проверить и поправить)
- Modify: `apps/web/app/pages/app/categories.test.ts` (фикстуры `income`/`expense` — добавить `icon: null`)

**Interfaces:**
- Consumes: `CategoryView.icon` из Task 2 (форма ответа API).
- Produces: `CategoryDto.icon: string | null`; `CATEGORY_ICON_OPTIONS: readonly { key: string; label: string; component: Component }[]` (экспорт из `category-icon.ts`, использует Task 5 — пикер); `categoryIcon(icon: string | null, transactionType: 'INCOME' | 'EXPENSE'): Component`.

- [ ] **Step 1: Написать падающие тесты для нового `categoryIcon`**

Заменить `apps/web/app/components/operations/category-icon.test.ts` на:

```ts
import { ArrowDownLeft, ArrowUpRight, Banknote, ShoppingCart } from '@lucide/vue';
import { describe, expect, it } from 'vitest';

import { CATEGORY_ICON_OPTIONS, categoryIcon } from './category-icon.js';

describe('categoryIcon', () => {
  it('maps a known icon key', () => {
    expect(categoryIcon('shopping-cart', 'EXPENSE')).toBe(ShoppingCart);
    expect(categoryIcon('banknote', 'INCOME')).toBe(Banknote);
  });

  it('falls back to the operation type when icon is null', () => {
    expect(categoryIcon(null, 'INCOME')).toBe(ArrowDownLeft);
    expect(categoryIcon(null, 'EXPENSE')).toBe(ArrowUpRight);
  });

  it('falls back for an unknown icon key', () => {
    expect(categoryIcon('not-a-real-icon', 'EXPENSE')).toBe(ArrowUpRight);
  });
});

describe('CATEGORY_ICON_OPTIONS', () => {
  it('has a unique, non-empty key and label for every option', () => {
    expect(CATEGORY_ICON_OPTIONS.length).toBeGreaterThan(0);
    const keys = CATEGORY_ICON_OPTIONS.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of CATEGORY_ICON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `pnpm --filter @harmofin/web test -- category-icon.test.ts`
Expected: FAIL — `CATEGORY_ICON_OPTIONS` не существует, `categoryIcon('shopping-cart', ...)` вернёт fallback, а не `ShoppingCart`.

- [ ] **Step 3: Переписать `category-icon.ts` на каталог по ключу иконки**

Заменить `apps/web/app/components/operations/category-icon.ts` целиком:

```ts
import {
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  Baby,
  Banknote,
  Car,
  CircleDollarSign,
  Coffee,
  CreditCard,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gift,
  Hammer,
  HandCoins,
  HeartPulse,
  House,
  KeyRound,
  Landmark,
  Package,
  Palette,
  PawPrint,
  Percent,
  Pill,
  Plane,
  Repeat,
  School,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sparkles,
  SprayCan,
  SquareParking,
  Stethoscope,
  Syringe,
  Tag,
  Ticket,
  Truck,
  Utensils,
  Volleyball,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from '@lucide/vue';
import type { Component } from 'vue';

export interface CategoryIconOption {
  key: string;
  label: string;
  component: Component;
}

// The fixed icon catalog a user can pick from for a leaf category. Keys mirror
// CATEGORY_ICON_KEYS in apps/api/src/categories/category.schemas.ts — keep both in sync.
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { key: 'award', label: 'Награда', component: Award },
  { key: 'baby', label: 'Малыш', component: Baby },
  { key: 'banknote', label: 'Банкнота', component: Banknote },
  { key: 'car', label: 'Автомобиль', component: Car },
  { key: 'circle-dollar-sign', label: 'Деньги', component: CircleDollarSign },
  { key: 'coffee', label: 'Кофе', component: Coffee },
  { key: 'credit-card', label: 'Банковская карта', component: CreditCard },
  { key: 'dumbbell', label: 'Гантеля', component: Dumbbell },
  { key: 'ellipsis', label: 'Многоточие', component: Ellipsis },
  { key: 'fuel', label: 'Топливо', component: Fuel },
  { key: 'gift', label: 'Подарок', component: Gift },
  { key: 'hammer', label: 'Молоток', component: Hammer },
  { key: 'hand-coins', label: 'Монеты в руке', component: HandCoins },
  { key: 'heart-pulse', label: 'Пульс', component: HeartPulse },
  { key: 'house', label: 'Дом', component: House },
  { key: 'key-round', label: 'Ключ', component: KeyRound },
  { key: 'landmark', label: 'Учреждение', component: Landmark },
  { key: 'package', label: 'Посылка', component: Package },
  { key: 'palette', label: 'Палитра', component: Palette },
  { key: 'paw-print', label: 'Лапка', component: PawPrint },
  { key: 'percent', label: 'Процент', component: Percent },
  { key: 'pill', label: 'Таблетка', component: Pill },
  { key: 'plane', label: 'Самолёт', component: Plane },
  { key: 'repeat', label: 'Повтор', component: Repeat },
  { key: 'school', label: 'Школа', component: School },
  { key: 'shield-check', label: 'Щит', component: ShieldCheck },
  { key: 'shirt', label: 'Одежда', component: Shirt },
  { key: 'shopping-cart', label: 'Тележка покупок', component: ShoppingCart },
  { key: 'smartphone', label: 'Смартфон', component: Smartphone },
  { key: 'sparkles', label: 'Блёстки', component: Sparkles },
  { key: 'spray-can', label: 'Баллончик', component: SprayCan },
  { key: 'square-parking', label: 'Парковка', component: SquareParking },
  { key: 'stethoscope', label: 'Стетоскоп', component: Stethoscope },
  { key: 'syringe', label: 'Шприц', component: Syringe },
  { key: 'tag', label: 'Ярлык', component: Tag },
  { key: 'ticket', label: 'Билет', component: Ticket },
  { key: 'truck', label: 'Грузовик', component: Truck },
  { key: 'utensils', label: 'Приборы', component: Utensils },
  { key: 'volleyball', label: 'Мяч', component: Volleyball },
  { key: 'wallet', label: 'Кошелёк', component: Wallet },
  { key: 'wifi', label: 'Wi-Fi', component: Wifi },
  { key: 'wine', label: 'Вино', component: Wine },
  { key: 'wrench', label: 'Гаечный ключ', component: Wrench },
  { key: 'zap', label: 'Молния', component: Zap },
];

const ICONS: Record<string, Component> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((option) => [option.key, option.component]),
);

export function categoryIcon(
  icon: string | null,
  transactionType: 'INCOME' | 'EXPENSE',
): Component {
  const mapped = icon === null ? undefined : ICONS[icon];
  if (mapped !== undefined) return mapped;
  return transactionType === 'INCOME' ? ArrowDownLeft : ArrowUpRight;
}
```

- [ ] **Step 4: Прогнать тест `category-icon.test.ts`**

Run: `pnpm --filter @harmofin/web test -- category-icon.test.ts`
Expected: PASS.

- [ ] **Step 5: Обновить вызовы `categoryIcon` на трёх местах**

В `apps/web/app/pages/app/categories.vue` заменить:

```ts
                    :is="categoryIcon(entry.category.templateKey, entry.category.categoryType)"
```

на:

```ts
                    :is="categoryIcon(entry.category.icon, entry.category.categoryType)"
```

В `apps/web/app/components/operations/OperationRow.vue` заменить проп и его использование:

```ts
const props = defineProps<{
  transaction: TransactionDto;
  categoryName: string;
  categoryIcon: string | null;
  accountName: string;
  envelopeName: string | null;
}>();

defineEmits<{ select: [] }>();

const icon = computed(() => categoryIconComponent(props.categoryIcon, props.transaction.transactionType));
```

и переименовать импорт, чтобы не путать имя пропа `categoryIcon` с функцией:

```ts
import { categoryIcon as categoryIconComponent } from './category-icon.js';
```

В `apps/web/app/pages/app/operations.vue` заменить функцию (была `categoryTemplateKey`):

```ts
function categoryIcon(transaction: TransactionDto): string | null {
  return categoryById.value.get(transaction.categoryId)?.icon ?? null;
}
```

и в шаблоне заменить проп у `<OperationRow ...>`:

```html
:category-icon="categoryIcon(transaction)"
```

(было `:category-template-key="categoryTemplateKey(transaction)"`).

- [ ] **Step 6: Поправить `OperationRow.test.ts`**

В `apps/web/app/components/operations/OperationRow.test.ts` в функции `mountRow` заменить:

```ts
      categoryTemplateKey: 'expense-groceries',
```

на:

```ts
      categoryIcon: 'shopping-cart',
```

Остальной файл не трогать.

- [ ] **Step 7: Добавить `icon` в DTO**

В `apps/web/app/composables/useBudgetReferenceData.ts` добавить `icon: string | null;` в `CategoryDto` (после `comment: string | null;`):

```ts
export interface CategoryDto {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
  archivedAt: string | null;
}
```

Добавить `icon?: string | null | undefined;` в `CreateCategoryInput` (после `comment?: ...`) и в `UpdateCategoryInput` (после `comment?: ...`) — оба интерфейса в этом же файле.

- [ ] **Step 8: Поправить фикстуры категорий в `categories.test.ts`**

В `apps/web/app/pages/app/categories.test.ts` добавить `icon: null` в объект `income` (после `comment: null,`):

```ts
const income = {
  id: 'income-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Зарплата',
  categoryType: 'INCOME' as const,
  parentId: null,
  displayOrder: 0,
  comment: null,
  icon: null,
  archivedAt: null,
};
```

(`expense` наследует через `{ ...income, ... }`, правка не нужна).

- [ ] **Step 9: Прогнать весь web unit-набор и typecheck**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck`
Expected: всё PASS.

- [ ] **Step 10: Коммит**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/components/operations apps/web/app/pages/app/categories.vue apps/web/app/pages/app/operations.vue apps/web/app/pages/app/categories.test.ts
git commit -m "feat(web): switch category icon rendering to the icon field"
```

---

### Task 5: `CategoryIconPicker.vue`

**Files:**
- Create: `apps/web/app/components/categories/CategoryIconPicker.vue`
- Create: `apps/web/app/components/categories/CategoryIconPicker.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_ICON_OPTIONS` из `category-icon.ts` (Task 4).
- Produces: компонент с `defineProps<{ modelValue: string | null }>()` и `defineEmits<{ 'update:modelValue': [string | null] }>()` — используется в Task 6.

- [ ] **Step 1: Написать падающий component-тест**

Создать `apps/web/app/components/categories/CategoryIconPicker.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CategoryIconPicker from './CategoryIconPicker.vue';

describe('CategoryIconPicker', () => {
  it('marks the selected icon as pressed', () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: 'shopping-cart' } });
    const selected = wrapper.get('button[aria-pressed="true"]');
    expect(selected.attributes('aria-label')).toContain('Тележка покупок');
    expect(wrapper.findAll('button[aria-pressed="false"]').length).toBeGreaterThan(0);
  });

  it('emits the clicked icon key', async () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: null } });
    const buttons = wrapper.findAll('button');
    const target = buttons.find((button) => button.attributes('aria-label')?.includes('Кошелёк'));
    await target!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['wallet']]);
  });

  it('clicking the already-selected icon clears it', async () => {
    const wrapper = mount(CategoryIconPicker, { props: { modelValue: 'wallet' } });
    const selected = wrapper.get('button[aria-pressed="true"]');
    await selected.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });
});
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `pnpm --filter @harmofin/web test -- CategoryIconPicker.test.ts`
Expected: FAIL — файл компонента не существует.

- [ ] **Step 3: Реализовать компонент**

Создать `apps/web/app/components/categories/CategoryIconPicker.vue`:

```vue
<script setup lang="ts">
import { CATEGORY_ICON_OPTIONS } from '../operations/category-icon.js';

defineOptions({ name: 'CategoryIconPicker' });

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

function select(key: string): void {
  emit('update:modelValue', props.modelValue === key ? null : key);
}
</script>

<template>
  <fieldset class="category-icon-picker">
    <legend>Иконка</legend>
    <div class="category-icon-picker__grid">
      <button
        v-for="option in CATEGORY_ICON_OPTIONS"
        :key="option.key"
        type="button"
        class="category-icon-picker__item"
        :aria-pressed="option.key === modelValue"
        :aria-label="option.label"
        @click="select(option.key)"
      >
        <component :is="option.component" :size="18" aria-hidden="true" />
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.category-icon-picker {
  border: none;
  padding: 0;
  margin: 0 0 var(--space-3, 12px);
}

.category-icon-picker legend {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: var(--space-2, 8px);
  padding: 0;
}

.category-icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
}

.category-icon-picker__item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  min-width: 40px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #d8dee4);
  background: var(--color-surface, #fff);
  color: var(--color-text-secondary, #445);
  cursor: pointer;
}

.category-icon-picker__item[aria-pressed='true'] {
  border-color: var(--color-primary, #1ba39c);
  color: var(--color-primary, #1ba39c);
  background: var(--color-primary-subtle, #e6f5f4);
}
</style>
```

(Названия CSS-переменных — плейсхолдеры под текущие токены Calm Fintech; перед мёрджем свериться с [tokens.css](../../../apps/web/app/assets/styles/tokens.css) и заменить на реальные имена, если они отличаются.)

- [ ] **Step 4: Прогнать тест**

Run: `pnpm --filter @harmofin/web test -- CategoryIconPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint и typecheck**

Run: `pnpm --filter @harmofin/web lint && pnpm --filter @harmofin/web typecheck`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add apps/web/app/components/categories
git commit -m "feat(web): add CategoryIconPicker component"
```

---

### Task 6: Подключить пикер в форму категории

**Files:**
- Modify: `apps/web/app/pages/app/categories.vue`
- Modify: `apps/web/app/pages/app/categories.test.ts`

**Interfaces:**
- Consumes: `CategoryIconPicker.vue` (Task 5), `CreateCategoryInput.icon` / `UpdateCategoryInput.icon` (Task 4).

- [ ] **Step 1: Написать падающий тест видимости пикера**

Добавить в `apps/web/app/pages/app/categories.test.ts`, в конец `describe('categories page', ...)` (перед закрывающей `});` файла):

```ts
  it('shows the icon picker only for a leaf category and sends the chosen icon', async () => {
    mocks.api.createCategory.mockResolvedValue(income);
    wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-category"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('.category-icon-picker')).toBeNull();

    // The create form defaults categoryType to INCOME, so the parent option pool
    // (parentOptions() filters by matching categoryType) only offers the INCOME fixture.
    const parentSelect = document.querySelector('select[name="parentId"]') as HTMLSelectElement;
    parentSelect.value = 'income-id';
    parentSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect(document.querySelector('.category-icon-picker')).not.toBeNull();

    const walletButton = Array.from(document.querySelectorAll('.category-icon-picker button')).find(
      (button) => button.getAttribute('aria-label') === 'Кошелёк',
    ) as HTMLButtonElement;
    walletButton.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
    nameInput.value = 'Дочерняя категория';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const form = document.querySelector('form[data-category-form]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.api.createCategory).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({ parentId: 'income-id', icon: 'wallet' }),
    );
  });
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `pnpm --filter @harmofin/web test -- categories.test.ts -t "shows the icon picker only for a leaf"`
Expected: FAIL — `.category-icon-picker` нигде не рендерится.

- [ ] **Step 3: Подключить пикер в `categories.vue`**

Добавить импорт (рядом с остальными импортами компонентов):

```ts
import CategoryIconPicker from '../../components/categories/CategoryIconPicker.vue';
```

Добавить `icon` в реактивный `form` (после `parentId: ''`):

```ts
const form = reactive({
  name: '',
  categoryType: 'INCOME' as CategoryType,
  parentId: '',
  icon: null as string | null,
  displayOrder: '0',
  comment: '',
});
```

Добавить `'icon'` в кортеж `categoryFields`:

```ts
const categoryFields = ['name', 'categoryType', 'parentId', 'icon', 'displayOrder', 'comment'] as const;
```

В `resetForm` добавить `form.icon = null;` (после `form.parentId = '';`).

В `startEdit` добавить `form.icon = category.icon;` (после `form.parentId = category.parentId ?? '';`).

В `saveCategory` в обеих ветках (`editingId.value` и создание) добавить `icon: form.parentId ? form.icon : null,` в объекты `input` (после `parentId: form.parentId || null,`):

```ts
      const input: UpdateCategoryInput = {
        name: form.name,
        parentId: form.parentId || null,
        icon: form.parentId ? form.icon : null,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
```

```ts
      const input: CreateCategoryInput = {
        name: form.name,
        categoryType: form.categoryType,
        parentId: form.parentId || null,
        icon: form.parentId ? form.icon : null,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
```

В шаблоне вставить пикер между `UiSelect` для `parentId` и `UiInput` для `displayOrder`:

```html
        <UiSelect
          v-model="form.parentId"
          name="parentId"
          label="Родительская категория"
          placeholder="Без родительской категории"
          :options="parentOptions()"
          :error="getFieldError('parentId')"
        />
        <CategoryIconPicker v-if="form.parentId" v-model="form.icon" />
        <UiInput
          v-model="form.displayOrder"
          name="displayOrder"
          label="Порядок отображения"
          inputmode="numeric"
          :error="getFieldError('displayOrder')"
          required
        />
```

- [ ] **Step 4: Прогнать тест**

Run: `pnpm --filter @harmofin/web test -- categories.test.ts -t "shows the icon picker only for a leaf"`
Expected: PASS.

- [ ] **Step 5: Прогнать весь тест-файл и весь web-набор**

Run: `pnpm --filter @harmofin/web test -- categories.test.ts && pnpm --filter @harmofin/web test`
Expected: всё PASS (включая ранее существовавший тест `'renders separate income and expense regions and creates typed category'` — он создаёт категорию без `parentId`, значит `icon` в её payload будет `null`, что не противоречит `expect.objectContaining({...})` в том тесте, так как `objectContaining` не проверяет отсутствующие поля).

- [ ] **Step 6: Typecheck и lint**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 7: Ручная проверка в браузере**

Запустить дев-сервер (`pnpm dev` или через Browser-превью), открыть `/app/categories`, создать категорию без родителя — убедиться, что пикер иконки не показывается; выбрать родителя — пикер появляется, выбор иконки подсвечивается; сохранить — категория отображается с выбранной иконкой в списке (иконка рендерится у листовых строк).

- [ ] **Step 8: Коммит**

```bash
git add apps/web/app/pages/app/categories.vue apps/web/app/pages/app/categories.test.ts
git commit -m "feat(web): wire the icon picker into the category form"
```

---

## Self-Review

**Spec coverage:**
- Колонка `icon` + бэкфилл → Task 1. ✅
- Каталог из ~40+2 иконок, allow-list на границе API → Task 2 (zod), Task 4 (web-карта). ✅
- Правило «иконка только у листа» → Task 2 (application service). ✅
- Шаблон пишет `icon` напрямую → Task 3. ✅
- Аддитивный API-контракт (DTO/Swagger) → Task 2 Step 7. ✅
- `category-icon.ts` — единственный рендер-источник по `icon`, а не `templateKey` → Task 4. ✅
- `CategoryIconPicker`, виден только для листа → Task 5, Task 6. ✅
- Вне рамок (цвет, иконки групп) — не тронуто ни в одной задаче. ✅

**Placeholder scan:** пройден, плейсхолдеров/TODO нет (кроме явно помеченного плейсхолдера CSS-токенов в Task 5, который является намеренной пометкой «свериться перед мёрджем», а не недоделанным шагом).

**Type consistency:** `icon: string | null` — единое имя и тип на всех слоях (Prisma → `CategoryRecord`/`CategoryCreateData`/`CategoryUpdateData` → `CategoryView` → `CategoryResponse` → web `CategoryDto`). `categoryIcon(icon, transactionType)` — сигнатура одинакова в определении (Task 4) и во всех вызовах (Task 4 Step 5, `OperationRow.vue`, `categories.vue`, `operations.vue`). `CATEGORY_ICON_OPTIONS` определён в Task 4, потребляется в Task 5 без переименований.
