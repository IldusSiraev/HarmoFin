import { Injectable } from '@nestjs/common';
import { CategoryType } from '@prisma/client';

import { RolePolicy } from '../common/policies/role-policy.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import {
  CategoryRepository,
  type CategoryRecord,
  type CategoryUpdateData,
} from './category.repository.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './category.schemas.js';

export interface CategoryView {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  categoryType: 'INCOME' | 'EXPENSE';
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  archivedAt: string | null;
}

@Injectable()
export class CategoryApplicationService {
  constructor(
    private readonly repository: CategoryRepository,
    private readonly rolePolicy: RolePolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    categoryType: CategoryType | undefined,
    status: ReferenceDataStatus,
    options?: { sort?: 'default' | 'popular' | undefined; limit?: number | undefined },
  ): Promise<CategoryView[]> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return (
      await this.repository.list(userId, budgetId, categoryType, status, options)
    ).map((category) => this.toView(category));
  }

  async get(userId: string, budgetId: string, categoryId: string): Promise<CategoryView> {
    const category = await this.repository.find(userId, budgetId, categoryId);
    if (!category) throw resourceNotFound();
    return this.toView(category);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateCategoryInput,
    requestId?: string,
  ): Promise<CategoryView> {
    await this.requireOwnerBudget(userId, budgetId);
    await this.validateParent(userId, budgetId, input.categoryType, input.parentId ?? null);
    const category = await this.repository.create(
      userId,
      {
        budgetId,
        name: input.name,
        categoryType: input.categoryType,
        parentId: input.parentId ?? null,
        displayOrder: input.displayOrder,
        comment: input.comment ?? null,
      },
      requestId,
    );
    if (!category) throw resourceNotFound();
    return this.toView(category);
  }

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

  async archive(
    userId: string,
    budgetId: string,
    categoryId: string,
    requestId?: string,
  ): Promise<CategoryView> {
    await this.requireOwnerBudget(userId, budgetId);
    const category = await this.repository.archive(userId, budgetId, categoryId, requestId);
    if (!category) throw resourceNotFound();
    return this.toView(category);
  }

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
      archivedAt: category.archivedAt?.toISOString() ?? null,
    };
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
    return budget;
  }

  private async validateParent(
    userId: string,
    budgetId: string,
    categoryType: CategoryType,
    parentId: string | null,
    categoryId?: string,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === categoryId) throw invalidReference();

    const parent = await this.repository.findParent(userId, budgetId, parentId);
    if (
      !parent ||
      parent.budgetId !== budgetId ||
      parent.archivedAt !== null ||
      parent.categoryType !== categoryType
    ) {
      throw invalidReference();
    }
    if (!categoryId) return;

    const ancestorIds = await this.repository.findAncestorIds(userId, budgetId, parentId);
    if (ancestorIds.includes(categoryId)) throw invalidReference();
  }
}

function updateData(input: UpdateCategoryInput): CategoryUpdateData {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  };
}
