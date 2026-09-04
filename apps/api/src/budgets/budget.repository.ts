import { CategoryType, EnvelopeType } from '@prisma/client';

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

      const [existingCategories, existingEnvelopes] = await Promise.all([
        tx.category.findMany({
          where: { budgetId, templateKey: { in: DEFAULT_CATEGORY_KEYS } },
          select: { templateKey: true },
        }),
        tx.envelope.findMany({
          where: { budgetId, templateKey: { in: DEFAULT_ENVELOPE_KEYS } },
          select: { templateKey: true },
        }),
      ]);
      const existingCategoryKeys = existingCategories.flatMap((item) =>
        item.templateKey ? [item.templateKey] : [],
      );
      const existingEnvelopeKeys = existingEnvelopes.flatMap((item) =>
        item.templateKey ? [item.templateKey] : [],
      );
      const existingCategoryKeySet = new Set(existingCategoryKeys);
      const existingEnvelopeKeySet = new Set(existingEnvelopeKeys);
      const categoriesToCreate = DEFAULT_CATEGORIES.filter(
        ([templateKey]) => !existingCategoryKeySet.has(templateKey),
      );
      const envelopesToCreate = DEFAULT_ENVELOPES.filter(
        ([templateKey]) => !existingEnvelopeKeySet.has(templateKey),
      );

      if (categoriesToCreate.length > 0) {
        await tx.category.createMany({
          data: categoriesToCreate.map(([templateKey, name, categoryType, displayOrder]) => ({
            id: createUuidV7(),
            budgetId,
            templateKey,
            name,
            categoryType,
            displayOrder,
          })),
        });
      }
      if (envelopesToCreate.length > 0) {
        await tx.envelope.createMany({
          data: envelopesToCreate.map(([templateKey, name, envelopeType, displayOrder]) => ({
            id: createUuidV7(),
            budgetId,
            templateKey,
            name,
            envelopeType,
            startingBalanceMinor: 0n,
            displayOrder,
          })),
        });
      }

      const result = {
        createdCategoryKeys: categoriesToCreate.map(([templateKey]) => templateKey).sort(),
        existingCategoryKeys: [...existingCategoryKeys].sort(),
        createdEnvelopeKeys: envelopesToCreate.map(([templateKey]) => templateKey).sort(),
        existingEnvelopeKeys: [...existingEnvelopeKeys].sort(),
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

type DefaultCategory = readonly [
  templateKey: string,
  name: string,
  categoryType: CategoryType,
  displayOrder: number,
];
type DefaultEnvelope = readonly [
  templateKey: string,
  name: string,
  envelopeType: EnvelopeType,
  displayOrder: number,
];

const DEFAULT_INCOME_CATEGORIES = [
  ['income-salary', 'Зарплата'],
  ['income-shabashka', 'Шабашка'],
  ['income-other', 'Прочий доход'],
  ['income-cashback', 'Кэшбек'],
  ['income-deposit-interest', 'Проценты от вкладов'],
] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  ['expense-wife', 'Жена'],
  ['expense-groceries', 'Продукты'],
  ['expense-mortgage', 'Ипотека'],
  ['expense-fuel', 'Бензин'],
  ['expense-activities', 'Секции и кружки'],
  ['expense-leisure', 'Досуг'],
  ['expense-car-service', 'Автосервис'],
  ['expense-cafes', 'Кафе и рестораны'],
  ['expense-household', 'Хозтовары'],
  ['expense-clothes', 'Одежда'],
  ['expense-subscriptions', 'Подписки'],
  ['expense-utilities', 'Коммуналка'],
  ['expense-pharmacy', 'Аптека'],
  ['expense-fast-food', 'Фастфуд'],
  ['expense-sport', 'Спорт и фитнес'],
  ['expense-kindergarten', 'Детский сад'],
  ['expense-clinic', 'Клиника'],
  ['expense-repair', 'Ремонт'],
  ['expense-children-leisure', 'Досуг детей'],
  ['expense-beauty', 'Красота'],
  ['expense-taxi', 'Такси'],
  ['expense-gifts', 'Подарки'],
  ['expense-internet', 'Интернет'],
  ['expense-electronics', 'Электроника'],
  ['expense-mobile', 'Мобильная связь'],
  ['expense-alcohol', 'Алкоголь'],
  ['expense-parking', 'Парковка'],
  ['expense-insurance', 'Страховка'],
  ['expense-education', 'Образование'],
  ['expense-travel', 'Путешествия'],
  ['expense-home-repair', 'Ремонт/жилье'],
  ['expense-bank-fees', 'Банковские комиссии'],
  ['expense-taxes', 'Налоги'],
  ['expense-other', 'Прочее'],
] as const;

const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  ...DEFAULT_INCOME_CATEGORIES.map(([templateKey, name], displayOrder): DefaultCategory => [
    templateKey,
    name,
    CategoryType.INCOME,
    displayOrder,
  ]),
  ...DEFAULT_EXPENSE_CATEGORIES.map(([templateKey, name], index): DefaultCategory => [
    templateKey,
    name,
    CategoryType.EXPENSE,
    index + DEFAULT_INCOME_CATEGORIES.length,
  ]),
];

const DEFAULT_ENVELOPES: readonly DefaultEnvelope[] = [
  ['envelope-current-10-24', 'Текущие 10–24', EnvelopeType.CURRENT_EXPENSES, 0],
  ['envelope-current-25-9', 'Текущие 25–9', EnvelopeType.CURRENT_EXPENSES, 1],
  ['envelope-mandatory', 'Обязательные', EnvelopeType.MANDATORY_EXPENSES, 2],
  ['envelope-repair', 'Ремонт', EnvelopeType.SAVINGS_GOAL, 3],
  ['envelope-car', 'Автомобиль', EnvelopeType.SAVINGS_GOAL, 4],
  ['envelope-free', 'Свободные', EnvelopeType.FREE_MONEY, 5],
];

const DEFAULT_CATEGORY_KEYS = DEFAULT_CATEGORIES.map(([templateKey]) => templateKey);
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
