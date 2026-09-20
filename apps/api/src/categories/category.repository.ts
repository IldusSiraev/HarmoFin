import { Prisma, type CategoryType } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { duplicateName, invalidReference } from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import { PrismaService } from '../database/prisma.service.js';

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

export interface CategoryCreateData {
  budgetId: string;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
}

export interface CategoryUpdateData {
  name?: string;
  parentId?: string | null;
  displayOrder?: number;
  comment?: string | null;
  icon?: string | null;
}

export class CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        workspaceId: true,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async list(
    userId: string,
    budgetId: string,
    categoryType: CategoryType | undefined,
    status: ReferenceDataStatus,
    options: { sort?: 'default' | 'popular' | undefined; limit?: number | undefined } = {},
  ): Promise<CategoryRecord[]> {
    const where = {
      budgetId,
      ...(categoryType ? { categoryType } : {}),
      ...archiveWhere(status),
      budget: activeBudgetWhere(userId, budgetId),
    };

    if (options.sort !== 'popular') {
      return this.prisma.category.findMany({
        where,
        select: categorySelect,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
    }

    const candidates = await this.prisma.category.findMany({ where, select: { id: true } });
    if (candidates.length === 0) return [];

    const usage = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { budgetId, status: 'CONFIRMED', categoryId: { in: candidates.map((c) => c.id) } },
      _count: { categoryId: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: options.limit ?? 15,
    });
    if (usage.length === 0) return [];

    const popular = await this.prisma.category.findMany({
      where: { id: { in: usage.map((row) => row.categoryId) } },
      select: categorySelect,
    });
    const byId = new Map(popular.map((category) => [category.id, category]));
    // groupBy does not preserve the requested ordering, so the usage-ranked
    // order from the aggregate query has to be reapplied here.
    return usage
      .map((row) => byId.get(row.categoryId))
      .filter((category): category is CategoryRecord => category !== undefined);
  }

  async find(userId: string, budgetId: string, categoryId: string): Promise<CategoryRecord | null> {
    return this.prisma.category.findFirst({
      where: { id: categoryId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: categorySelect,
    });
  }

  async findParent(
    userId: string,
    budgetId: string,
    parentId: string,
  ): Promise<CategoryRecord | null> {
    return this.prisma.category.findFirst({
      where: {
        id: parentId,
        budgetId,
        archivedAt: null,
        budget: activeOwnerBudgetWhere(userId, budgetId),
      },
      select: categorySelect,
    });
  }

  async findAncestorIds(userId: string, budgetId: string, categoryId: string): Promise<string[]> {
    const maxDepth = await this.prisma.category.count({
      where: { budgetId, budget: activeOwnerBudgetWhere(userId, budgetId) },
    });
    const ancestorIds: string[] = [];
    let currentId: string | null = categoryId;

    for (let depth = 0; currentId && depth <= maxDepth; depth += 1) {
      const currentCategory: { id: string; parentId: string | null } | null =
        await this.prisma.category.findFirst({
          where: {
            id: currentId,
            budgetId,
            budget: activeOwnerBudgetWhere(userId, budgetId),
          },
          select: { id: true, parentId: true },
        });
      if (!currentCategory) break;
      ancestorIds.push(currentCategory.id);
      currentId = currentCategory.parentId;
    }

    return ancestorIds;
  }

  async hasActiveChildren(userId: string, budgetId: string, categoryId: string): Promise<boolean> {
    const child = await this.prisma.category.findFirst({
      where: {
        budgetId,
        parentId: categoryId,
        archivedAt: null,
        budget: activeBudgetWhere(userId, budgetId),
      },
      select: { id: true },
    });
    return child !== null;
  }

  async create(
    userId: string,
    input: CategoryCreateData,
    requestId?: string,
  ): Promise<CategoryRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const budget = await tx.budget.findFirst({
          where: activeOwnerBudgetWhere(userId, input.budgetId),
          select: { workspaceId: true },
        });
        if (!budget) return null;

        await validateParentInTransaction(tx, input.budgetId, input.categoryType, input.parentId);

        const category = await tx.category.create({
          data: { id: createUuidV7(), ...input },
          select: categorySelect,
        });
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId: input.budgetId,
            entityType: 'category',
            entityId: category.id,
            action: 'CREATED',
            source: 'API',
            requestId: requestId ?? null,
            newValues: auditValues(category),
          },
        });
        return category;
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async update(
    userId: string,
    budgetId: string,
    categoryId: string,
    input: CategoryUpdateData,
    requestId?: string,
  ): Promise<CategoryRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.category.findFirst({
          where: {
            id: categoryId,
            budgetId,
            archivedAt: null,
            budget: activeOwnerBudgetWhere(userId, budgetId),
          },
          select: categorySelect,
        });
        if (!current) return null;

        if (input.parentId !== undefined) {
          await validateParentInTransaction(
            tx,
            budgetId,
            current.categoryType,
            input.parentId,
            categoryId,
          );
        }

        const [budget, category] = await Promise.all([
          tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { workspaceId: true } }),
          tx.category.update({ where: { id: categoryId }, data: input, select: categorySelect }),
        ]);
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId,
            entityType: 'category',
            entityId: category.id,
            action: 'UPDATED',
            source: 'API',
            requestId: requestId ?? null,
            oldValues: auditValues(current),
            newValues: auditValues(category),
          },
        });
        return category;
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async archive(
    userId: string,
    budgetId: string,
    categoryId: string,
    requestId?: string,
  ): Promise<CategoryRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.category.findFirst({
        where: {
          id: categoryId,
          budgetId,
          budget: activeOwnerBudgetWhere(userId, budgetId),
        },
        select: categorySelect,
      });
      if (!current) return null;
      if (current.archivedAt) return current;

      const activeChild = await tx.category.findFirst({
        where: { budgetId, parentId: categoryId, archivedAt: null },
        select: { id: true },
      });
      if (activeChild) throw invalidReference();

      const [budget, category] = await Promise.all([
        tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { workspaceId: true } }),
        tx.category.update({
          where: { id: categoryId },
          data: { archivedAt: new Date() },
          select: categorySelect,
        }),
      ]);
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId,
          entityType: 'category',
          entityId: category.id,
          action: 'ARCHIVED',
          source: 'API',
          requestId: requestId ?? null,
          oldValues: auditValues(current),
          newValues: auditValues(category),
        },
      });
      return category;
    });
  }
}

async function validateParentInTransaction(
  tx: Prisma.TransactionClient,
  budgetId: string,
  categoryType: CategoryType,
  parentId: string | null,
  categoryId?: string,
): Promise<void> {
  if (parentId === null) return;
  if (parentId === categoryId) throw invalidReference();

  const parent = await tx.category.findFirst({
    where: { id: parentId, budgetId, categoryType, archivedAt: null },
    select: { id: true },
  });
  if (!parent) throw invalidReference();
  if (!categoryId) return;

  const ancestorIds = await findAncestorIdsInTransaction(tx, budgetId, parentId);
  if (ancestorIds.includes(categoryId)) throw invalidReference();
}

async function findAncestorIdsInTransaction(
  tx: Prisma.TransactionClient,
  budgetId: string,
  categoryId: string,
): Promise<string[]> {
  const maxDepth = await tx.category.count({ where: { budgetId } });
  const ancestorIds: string[] = [];
  let currentId: string | null = categoryId;

  for (let depth = 0; currentId && depth <= maxDepth; depth += 1) {
    const currentCategory: { id: string; parentId: string | null } | null =
      await tx.category.findFirst({
        where: { id: currentId, budgetId },
        select: { id: true, parentId: true },
      });
    if (!currentCategory) break;
    ancestorIds.push(currentCategory.id);
    currentId = currentCategory.parentId;
  }

  return ancestorIds;
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

function activeOwnerBudgetWhere(userId: string, budgetId: string) {
  return {
    ...activeBudgetWhere(userId, budgetId),
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true, role: 'OWNER' as const } },
    },
  };
}

function archiveWhere(status: ReferenceDataStatus) {
  if (status === 'active') return { archivedAt: null };
  if (status === 'archived') return { archivedAt: { not: null } };
  return {};
}

function auditValues(category: CategoryRecord) {
  return {
    name: category.name,
    categoryType: category.categoryType,
    parentId: category.parentId,
    displayOrder: category.displayOrder,
    archivedAt: category.archivedAt?.toISOString() ?? null,
  };
}

function throwDuplicateName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw duplicateName();
  }
  throw error;
}

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
