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
