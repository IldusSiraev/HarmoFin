import { CategoryType, EnvelopeType, type PeriodSlot } from '@prisma/client';

import { invalidReference } from '../common/reference-data/reference-data.errors.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface BudgetView {
  id: string;
  workspaceId: string;
  name: string;
  primaryCurrency: string;
  timezone: string;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  allowNegativeBalance: boolean;
  incomeAllocationRuleEnabled: boolean;
  incomeAllocationSourceCategoryId: string | null;
  incomeAllocationTargetEnvelopeId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface BudgetSettingsUpdate {
  name: string;
  timezone: string;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  allowNegativeBalance: boolean;
  incomeAllocationRuleEnabled: boolean;
  incomeAllocationSourceCategoryId: string | null;
  incomeAllocationTargetEnvelopeId: string | null;
}

export interface ReferenceTemplateResult {
  createdCategoryKeys: string[];
  existingCategoryKeys: string[];
  createdEnvelopeKeys: string[];
  existingEnvelopeKeys: string[];
}

export class BudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccessible(userId: string, budgetId: string): Promise<BudgetView | null> {
    return this.prisma.budget.findFirst({
      where: activeAccessibleBudgetWhere(userId, budgetId),
      select: budgetViewSelect,
    });
  }

  async listForWorkspace(userId: string, workspaceId: string): Promise<BudgetView[]> {
    return this.prisma.budget.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE', memberships: { some: { userId, isActive: true } } },
      },
      select: budgetViewSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeAccessibleBudgetWhere(userId, budgetId),
      select: {
        ...budgetViewSelect,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async findWorkspaceMembership(userId: string, workspaceId: string) {
    return this.prisma.workspaceMembership.findFirst({
      where: { userId, workspaceId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: { role: true },
    });
  }

  async create(
    userId: string,
    workspaceId: string,
    input: { name: string },
    requestId?: string,
  ): Promise<BudgetView> {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: { id: createUuidV7(), workspaceId, name: input.name },
        select: budgetViewSelect,
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId,
          budgetId: budget.id,
          entityType: 'budget',
          entityId: budget.id,
          action: 'CREATED',
          source: 'API',
          requestId: requestId ?? null,
          newValues: { name: budget.name, status: budget.status },
        },
      });
      return budget;
    });
  }

  async update(
    userId: string,
    budgetId: string,
    input: BudgetSettingsUpdate,
    requestId?: string,
  ): Promise<BudgetView | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.budget.findFirst({
        where: {
          ...activeAccessibleBudgetWhere(userId, budgetId),
          workspace: {
            status: 'ACTIVE',
            memberships: { some: { userId, isActive: true, role: 'OWNER' } },
          },
        },
        select: budgetViewSelect,
      });
      if (!current) return null;

      if (input.incomeAllocationRuleEnabled) {
        if (!input.incomeAllocationSourceCategoryId || !input.incomeAllocationTargetEnvelopeId) {
          throw invalidReference();
        }
        const [category, envelope] = await Promise.all([
          tx.category.findFirst({
            where: {
              id: input.incomeAllocationSourceCategoryId,
              budgetId,
              archivedAt: null,
            },
            select: { categoryType: true },
          }),
          tx.envelope.findFirst({
            where: { id: input.incomeAllocationTargetEnvelopeId, budgetId, archivedAt: null },
            select: { id: true },
          }),
        ]);
        if (category?.categoryType !== 'INCOME' || !envelope) throw invalidReference();
      }

      const budget = await tx.budget.update({
        where: { id: budgetId },
        data: input,
        select: budgetViewSelect,
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId: budget.id,
          entityType: 'budget',
          entityId: budget.id,
          action: 'UPDATED',
          source: 'API',
          requestId: requestId ?? null,
          oldValues: auditValues(current),
          newValues: auditValues(budget),
        },
      });
      return budget;
    });
  }

  async initializeReferenceTemplate(
    userId: string,
    budgetId: string,
    requestId?: string,
  ): Promise<ReferenceTemplateResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.findFirst({
        where: {
          ...activeAccessibleBudgetWhere(userId, budgetId),
          workspace: {
            status: 'ACTIVE',
            memberships: { some: { userId, isActive: true, role: 'OWNER' } },
          },
        },
        select: { id: true, workspaceId: true },
      });
      if (!budget) return null;

      const [existingCategories, activeCategories, existingEnvelopes, activeEnvelopes] =
        await Promise.all([
          tx.category.findMany({
            where: { budgetId, templateKey: { in: DEFAULT_CATEGORY_KEYS } },
            select: { id: true, templateKey: true },
          }),
          // The DB enforces case-insensitive name uniqueness per (budget, categoryType) for
          // active rows — a template row whose name collides with something the user (or an
          // older template revision) already created must adopt that row instead of inserting
          // a duplicate that the database would reject.
          tx.category.findMany({
            where: { budgetId, archivedAt: null },
            select: { id: true, templateKey: true, name: true, categoryType: true },
          }),
          tx.envelope.findMany({
            where: { budgetId, templateKey: { in: DEFAULT_ENVELOPE_KEYS } },
            select: { id: true, templateKey: true },
          }),
          tx.envelope.findMany({
            where: { budgetId, archivedAt: null },
            select: { id: true, templateKey: true, name: true },
          }),
        ]);
      const existingCategoryIdByKey = new Map(
        existingCategories.flatMap((item) =>
          item.templateKey ? [[item.templateKey, item.id] as const] : [],
        ),
      );
      const existingEnvelopeIdByKey = new Map(
        existingEnvelopes.flatMap((item) =>
          item.templateKey ? [[item.templateKey, item.id] as const] : [],
        ),
      );
      const existingCategoryKeySet = new Set(existingCategoryIdByKey.keys());
      const existingEnvelopeKeySet = new Set(existingEnvelopeIdByKey.keys());
      const activeCategoryByNameType = new Map(
        activeCategories.map((item) => [nameTypeKey(item.categoryType, item.name), item] as const),
      );
      const activeEnvelopeByName = new Map(
        activeEnvelopes.map((item) => [item.name.trim().toLowerCase(), item] as const),
      );

      const categoriesToCreate: DefaultCategory[] = [];
      const adoptedCategories: Array<{
        templateKey: string;
        id: string;
        templateKeyIsNull: boolean;
      }> = [];
      for (const category of DEFAULT_CATEGORIES) {
        if (existingCategoryKeySet.has(category.templateKey)) continue;
        const collision = activeCategoryByNameType.get(
          nameTypeKey(category.categoryType, category.name),
        );
        if (collision) {
          adoptedCategories.push({
            templateKey: category.templateKey,
            id: collision.id,
            templateKeyIsNull: collision.templateKey === null,
          });
        } else {
          categoriesToCreate.push(category);
        }
      }

      const envelopesToCreate: DefaultEnvelope[] = [];
      const adoptedEnvelopes: Array<{
        templateKey: string;
        id: string;
        templateKeyIsNull: boolean;
      }> = [];
      for (const envelope of DEFAULT_ENVELOPES) {
        const [templateKey, name] = envelope;
        if (existingEnvelopeKeySet.has(templateKey)) continue;
        const collision = activeEnvelopeByName.get(name.trim().toLowerCase());
        if (collision) {
          adoptedEnvelopes.push({
            templateKey,
            id: collision.id,
            templateKeyIsNull: collision.templateKey === null,
          });
        } else {
          envelopesToCreate.push(envelope);
        }
      }

      const generatedCategoryIdByKey = new Map(
        categoriesToCreate.map((category) => [category.templateKey, createUuidV7()] as const),
      );
      const categoryIdByKey = new Map([
        ...existingCategoryIdByKey,
        ...generatedCategoryIdByKey,
        ...adoptedCategories.map((item) => [item.templateKey, item.id] as const),
      ]);

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
      await Promise.all(
        adoptedCategories
          .filter((item) => item.templateKeyIsNull)
          .map((item) =>
            tx.category.update({ where: { id: item.id }, data: { templateKey: item.templateKey } }),
          ),
      );
      if (envelopesToCreate.length > 0) {
        await tx.envelope.createMany({
          data: envelopesToCreate.map(
            ([templateKey, name, envelopeType, displayOrder, periodSlot, comment]) => ({
              id: createUuidV7(),
              budgetId,
              templateKey,
              name,
              envelopeType,
              periodSlot,
              startingBalanceMinor: 0n,
              displayOrder,
              comment: comment ?? null,
            }),
          ),
        });
      }
      await Promise.all(
        adoptedEnvelopes
          .filter((item) => item.templateKeyIsNull)
          .map((item) =>
            tx.envelope.update({ where: { id: item.id }, data: { templateKey: item.templateKey } }),
          ),
      );

      const result = {
        createdCategoryKeys: categoriesToCreate.map((category) => category.templateKey).sort(),
        existingCategoryKeys: [
          ...existingCategoryKeySet,
          ...adoptedCategories.map((item) => item.templateKey),
        ].sort(),
        createdEnvelopeKeys: envelopesToCreate.map(([templateKey]) => templateKey).sort(),
        existingEnvelopeKeys: [
          ...existingEnvelopeKeySet,
          ...adoptedEnvelopes.map((item) => item.templateKey),
        ].sort(),
      };
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId,
          entityType: 'budget',
          entityId: budgetId,
          action: 'REFERENCE_TEMPLATE_INITIALIZED',
          source: 'API',
          requestId: requestId ?? null,
          newValues: result,
        },
      });
      return result;
    });
  }
}

function nameTypeKey(categoryType: CategoryType, name: string): string {
  return `${categoryType}::${name.trim().toLowerCase()}`;
}

function activeAccessibleBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

function auditValues(budget: BudgetView) {
  return {
    name: budget.name,
    timezone: budget.timezone,
    cycleStartDay: budget.cycleStartDay,
    periodBoundaryOffset: budget.periodBoundaryOffset,
    allowNegativeBalance: budget.allowNegativeBalance,
    incomeAllocationRuleEnabled: budget.incomeAllocationRuleEnabled,
    incomeAllocationSourceCategoryId: budget.incomeAllocationSourceCategoryId,
    incomeAllocationTargetEnvelopeId: budget.incomeAllocationTargetEnvelopeId,
  };
}

interface DefaultCategory {
  templateKey: string;
  name: string;
  categoryType: CategoryType;
  parentTemplateKey: string | null;
  comment: string | null;
  icon: string | null;
  displayOrder: number;
}
type DefaultEnvelope = readonly [
  templateKey: string,
  name: string,
  envelopeType: EnvelopeType,
  displayOrder: number,
  periodSlot: PeriodSlot | null,
  comment?: string | null,
];

interface CategoryLeaf {
  templateKey: string;
  name: string;
  icon: string;
  comment?: string;
}
interface CategoryGroup {
  templateKey: string;
  name: string;
  children: readonly CategoryLeaf[];
}

// Keys mirror apps/web/app/components/operations/category-icon.ts — update both together.
const INCOME_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'income-group-salary',
    name: 'Зарплата',
    children: [
      {
        templateKey: 'income-advance',
        name: 'Аванс',
        icon: 'hand-coins',
        comment: 'аванс, часть зарплаты, предоплата',
      },
      {
        templateKey: 'income-salary',
        name: 'Расчёт',
        icon: 'banknote',
        comment: 'зарплата, расчёт, оклад',
      },
      {
        templateKey: 'income-bonus',
        name: 'Премия',
        icon: 'award',
        comment: 'премия, бонус, bonus',
      },
    ],
  },
  {
    templateKey: 'income-group-other',
    name: 'Прочий доход',
    children: [
      {
        templateKey: 'income-sale',
        name: 'Продажа',
        icon: 'circle-dollar-sign',
        comment: 'продажа личных вещей',
      },
      { templateKey: 'income-gift', name: 'Подарок', icon: 'gift', comment: 'подарок, наследство' },
      {
        templateKey: 'income-cashback',
        name: 'Кэшбэк',
        icon: 'credit-card',
        comment: 'кэшбэк, cashback, возврат',
      },
      {
        templateKey: 'income-deposit-interest',
        name: 'Проценты по вкладам',
        icon: 'percent',
        comment: 'проценты, вклад, депозит',
      },
      {
        templateKey: 'income-social',
        name: 'Социальные выплаты',
        icon: 'hand-coins',
        comment: 'пособия, выплаты, пенсия',
      },
    ],
  },
];

const EXPENSE_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'expense-group-housing',
    name: 'Жилье',
    children: [
      {
        templateKey: 'expense-mortgage',
        name: 'Ипотека',
        icon: 'house',
        comment: 'ипотека, кредит на жильё, ипотечный платёж, mortgage',
      },
      {
        templateKey: 'expense-rent',
        name: 'Аренда',
        icon: 'key-round',
        comment: 'аренда, аренда квартиры, съём, rent',
      },
      {
        templateKey: 'expense-utilities',
        name: 'Коммуналка',
        icon: 'zap',
        comment: 'коммуналка, жкх, квартплата, свет, газ, вода, отопление, utilities',
      },
    ],
  },
  {
    templateKey: 'expense-group-credit',
    name: 'Кредиты',
    children: [
      {
        templateKey: 'expense-consumer-loan',
        name: 'Потребительский кредит',
        icon: 'credit-card',
        comment: 'кредит, потребительский, займ',
      },
      {
        templateKey: 'expense-insurance',
        name: 'Страхование',
        icon: 'shield-check',
        comment: 'страховка, залог, страхование жизни, insurance',
      },
      {
        templateKey: 'expense-taxes',
        name: 'Налоги',
        icon: 'landmark',
        comment: 'налог, налоги, пени, налог на имущество, tax',
      },
    ],
  },
  {
    templateKey: 'expense-group-communication',
    name: 'Связь',
    children: [
      {
        templateKey: 'expense-internet',
        name: 'Интернет',
        icon: 'wifi',
        comment: 'интернет, wifi',
      },
      {
        templateKey: 'expense-mobile',
        name: 'Мобильная связь',
        icon: 'smartphone',
        comment: 'связь, мобильный, сотовый',
      },
    ],
  },
  {
    templateKey: 'expense-group-food',
    name: 'Еда',
    children: [
      {
        templateKey: 'expense-fast-food',
        name: 'Фастфуд',
        icon: 'coffee',
        comment: 'мак, kfc, ростикс, шаурма, бургер',
      },
      {
        templateKey: 'expense-groceries',
        name: 'Продукты',
        icon: 'shopping-cart',
        comment: 'продукты, магазин, супермаркет, продукты питания, маркет, гипермаркет, grocery',
      },
      {
        templateKey: 'expense-cafes',
        name: 'Кафе и рестораны',
        icon: 'utensils',
        comment: 'кафе, ресторан, обед, ужин, cafe',
      },
      {
        templateKey: 'expense-food-delivery',
        name: 'Доставка еды',
        icon: 'truck',
        comment: 'доставка, еда, самокат, delivery',
      },
      {
        templateKey: 'expense-alcohol',
        name: 'Алкоголь',
        icon: 'wine',
        comment: 'алкоголь, вино, пиво, крепкое',
      },
    ],
  },
  {
    templateKey: 'expense-group-transport',
    name: 'Транспорт',
    children: [
      {
        templateKey: 'expense-taxi',
        name: 'Такси',
        icon: 'car',
        comment: 'такси, uber, yandex go',
      },
      {
        templateKey: 'expense-fuel',
        name: 'Бензин',
        icon: 'fuel',
        comment: 'бензин, заправка, дизель, азс',
      },
      {
        templateKey: 'expense-parking',
        name: 'Парковка',
        icon: 'square-parking',
        comment: 'парковка, паркинг, стоянка',
      },
      {
        templateKey: 'expense-car-service',
        name: 'Автосервис',
        icon: 'wrench',
        comment: 'автозапчасти, ремонт авто, шиномонтаж, замена масла, то',
      },
    ],
  },
  {
    templateKey: 'expense-group-health',
    name: 'Здоровье',
    children: [
      {
        templateKey: 'expense-clinic',
        name: 'Клиника',
        icon: 'stethoscope',
        comment: 'клиника, поликлиника',
      },
      {
        templateKey: 'expense-pharmacy',
        name: 'Аптека',
        icon: 'pill',
        comment: 'аптека, лекарства, таблетки, медикаменты',
      },
      {
        templateKey: 'expense-dental',
        name: 'Стоматология',
        icon: 'syringe',
        comment: 'стоматолог, зубы, dental',
      },
      {
        templateKey: 'expense-beauty',
        name: 'Красота',
        icon: 'heart-pulse',
        comment: 'красота, спа, парикмахерская, косметика, ногти, массаж',
      },
      {
        templateKey: 'expense-sport',
        name: 'Спорт и фитнес',
        icon: 'dumbbell',
        comment: 'спорт, фитнес, спортзал, зал, бассейн',
      },
    ],
  },
  {
    templateKey: 'expense-group-shopping',
    name: 'Покупки',
    children: [
      {
        templateKey: 'expense-clothes',
        name: 'Одежда',
        icon: 'shirt',
        comment: 'одежда, обувь, платье, clothes, shoes',
      },
      {
        templateKey: 'expense-marketplaces',
        name: 'Маркетплейсы',
        icon: 'package',
        comment: 'маркетплейсы, вайлдберриз, озон, алиэкспресс, wildberries',
      },
      {
        templateKey: 'expense-electronics',
        name: 'Электроника',
        icon: 'smartphone',
        comment: 'электроника, техника, телефон, ноутбук, компьютер, gadgets',
      },
    ],
  },
  {
    templateKey: 'expense-group-entertainment',
    name: 'Развлечения',
    children: [
      {
        templateKey: 'expense-leisure',
        name: 'Досуг',
        icon: 'ticket',
        comment: 'кино, боулинг, парк',
      },
      {
        templateKey: 'expense-children-leisure',
        name: 'Досуг детей',
        icon: 'palette',
        comment: 'игровые, аттракционы',
      },
      {
        templateKey: 'expense-subscriptions',
        name: 'Подписки',
        icon: 'repeat',
        comment: 'netflix, spotify, youtube, кинопоиск, подписка',
      },
      {
        templateKey: 'expense-travel',
        name: 'Путешествия',
        icon: 'plane',
        comment: 'путешествия, отпуск, отель, тур, поездка, авиабилеты, travel',
      },
      { templateKey: 'expense-gifts', name: 'Подарки', icon: 'gift', comment: 'подарки, сюрприз' },
    ],
  },
  {
    templateKey: 'expense-group-kids',
    name: 'Дети',
    children: [
      {
        templateKey: 'expense-kindergarten',
        name: 'Детский сад',
        icon: 'baby',
        comment: 'детский сад, ясли, дошкольное',
      },
      {
        templateKey: 'expense-school',
        name: 'Школа',
        icon: 'school',
        comment: 'школа, учебники, форма, канцелярия',
      },
      {
        templateKey: 'expense-activities',
        name: 'Секции и кружки',
        icon: 'volleyball',
        comment: 'секции, кружки, репетитор',
      },
    ],
  },
  {
    templateKey: 'expense-group-home',
    name: 'Дом',
    children: [
      {
        templateKey: 'expense-household',
        name: 'Хозтовары',
        icon: 'sparkles',
        comment: 'хозтовары, посуда, мебель, интерьер',
      },
      {
        templateKey: 'expense-repair',
        name: 'Ремонт',
        icon: 'hammer',
        comment: 'ремонт, стройка, инструменты, отделка',
      },
      {
        templateKey: 'expense-pets',
        name: 'Питомцы',
        icon: 'paw-print',
        comment: 'питомцы, животные, собака, кошка, ветеринар',
      },
      {
        templateKey: 'expense-cleaning-supplies',
        name: 'Бытовая химия',
        icon: 'spray-can',
        comment: 'бытовая химия, чистящие средства, порошок',
      },
    ],
  },
];

const EXPENSE_STANDALONE_CATEGORIES: readonly CategoryLeaf[] = [
  { templateKey: 'expense-other', name: 'Прочее', icon: 'ellipsis' },
];

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

const DEFAULT_CATEGORIES: readonly DefaultCategory[] = buildDefaultCategories();

const DEFAULT_ENVELOPES: readonly DefaultEnvelope[] = [
  ['envelope-current-10-24', 'Первый период', EnvelopeType.CURRENT_EXPENSES, 0, 'FIRST', null],
  ['envelope-current-25-9', 'Второй период', EnvelopeType.CURRENT_EXPENSES, 1, 'SECOND', null],
  ['envelope-mandatory', 'Обязательные', EnvelopeType.MANDATORY_EXPENSES, 2, null],
  ['envelope-car', 'Автомобиль', EnvelopeType.SAVINGS_GOAL, 3, null],
  ['envelope-vacation', 'Отпуск', EnvelopeType.SAVINGS_GOAL, 4, null],
  ['envelope-free', 'Свободные', EnvelopeType.FREE_MONEY, 5, null],
];

const DEFAULT_CATEGORY_KEYS = DEFAULT_CATEGORIES.map((category) => category.templateKey);
const DEFAULT_ENVELOPE_KEYS = DEFAULT_ENVELOPES.map(([templateKey]) => templateKey);

const budgetViewSelect = {
  id: true,
  workspaceId: true,
  name: true,
  primaryCurrency: true,
  timezone: true,
  cycleStartDay: true,
  periodBoundaryOffset: true,
  allowNegativeBalance: true,
  incomeAllocationRuleEnabled: true,
  incomeAllocationSourceCategoryId: true,
  incomeAllocationTargetEnvelopeId: true,
  status: true,
} as const;
