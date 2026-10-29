import { CategoryType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { CategoryApplicationService } from './category.application.service.js';
import type { CategoryRecord, CategoryRepository } from './category.repository.js';
import type { CreateCategoryInput } from './category.schemas.js';

describe('CategoryApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';
  const otherBudgetId = '00000000-0000-4000-8000-000000000003';
  const rootId = '00000000-0000-4000-8000-000000000004';
  const parentId = '00000000-0000-4000-8000-000000000005';
  const childId = '00000000-0000-4000-8000-000000000006';

  it('rejects a parent from another budget or type', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.findParent.mockResolvedValue(
      category({ budgetId: otherBudgetId, categoryType: CategoryType.INCOME }),
    );

    await expect(
      service.create(ownerId, budgetId, categoryInput({ parentId, categoryType: 'INCOME' })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });

    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.findParent.mockResolvedValue(
      category({ budgetId, categoryType: CategoryType.INCOME }),
    );

    await expect(
      service.create(ownerId, budgetId, categoryInput({ parentId })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('rejects self-reference and a descendant cycle', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.find.mockResolvedValue(category({ id: rootId, budgetId }));
    repository.findParent.mockResolvedValue(category({ id: childId, budgetId }));
    repository.findAncestorIds.mockResolvedValue([childId, rootId]);

    await expect(
      service.update(ownerId, budgetId, rootId, { parentId: childId }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });

    await expect(
      service.update(ownerId, budgetId, rootId, { parentId: rootId }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('rejects archived parent', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.findParent.mockResolvedValue(category({ budgetId, archivedAt: new Date() }));

    await expect(
      service.create(ownerId, budgetId, categoryInput({ parentId })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new CategoryApplicationService(repository as unknown as CategoryRepository);
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      find: vi.fn(),
      findParent: vi.fn(),
      findAncestorIds: vi.fn(),
      create: vi.fn(),
    };
  }

  function ownerBudget() {
    return {
      id: budgetId,
      workspaceId: '00000000-0000-4000-8000-000000000007',
      workspace: { memberships: [{ role: 'OWNER' }] },
    };
  }

  function categoryInput(overrides: Partial<CreateCategoryInput> = {}): CreateCategoryInput {
    return {
      name: 'Продукты',
      categoryType: 'EXPENSE',
      parentId: null,
      displayOrder: 0,
      comment: null,
      ...overrides,
    };
  }

  function category(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
    return {
      id: parentId,
      budgetId,
      templateKey: null,
      name: 'Категория',
      categoryType: CategoryType.EXPENSE,
      parentId: null,
      displayOrder: 0,
      comment: null,
      icon: null,
      archivedAt: null,
      ...overrides,
    };
  }
});
