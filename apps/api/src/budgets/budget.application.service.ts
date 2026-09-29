import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { invalidReference } from '../common/reference-data/reference-data.errors.js';
import {
  BudgetRepository,
  type BudgetSettingsUpdate,
  type BudgetView,
} from './budget.repository.js';
import type { UpdateBudgetInput } from './budget.schemas.js';

@Injectable()
export class BudgetApplicationService {
  constructor(
    private readonly repository: BudgetRepository,
    private readonly rolePolicy: RolePolicy,
    private readonly planModelPolicy?: PlanModelPolicy,
  ) {}

  async get(userId: string, budgetId: string): Promise<BudgetView> {
    const budget = await this.repository.findAccessible(userId, budgetId);
    if (!budget) throw notFound();
    return budget;
  }

  async listForWorkspace(userId: string, workspaceId: string): Promise<BudgetView[]> {
    const membership = await this.repository.findWorkspaceMembership(userId, workspaceId);
    if (!membership) throw notFound();
    return this.repository.listForWorkspace(userId, workspaceId);
  }

  async create(
    userId: string,
    workspaceId: string,
    input: { name: string },
    requestId?: string,
  ): Promise<BudgetView> {
    const membership = await this.repository.findWorkspaceMembership(userId, workspaceId);
    if (!membership) throw notFound();
    if (!this.rolePolicy.canManage(membership.role)) throw forbidden();
    return this.repository.create(userId, workspaceId, input, requestId);
  }

  async update(
    userId: string,
    budgetId: string,
    input: UpdateBudgetInput,
    requestId?: string,
  ): Promise<BudgetView> {
    const accessible = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!accessible) throw notFound();
    const role = accessible.workspace.memberships[0]?.role;
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
    await this.requireBudgetPlanModel(userId, budgetId);

    const updatedInput = mergeSettings(accessible, input);
    if (
      updatedInput.incomeAllocationRuleEnabled &&
      (!updatedInput.incomeAllocationSourceCategoryId ||
        !updatedInput.incomeAllocationTargetEnvelopeId)
    ) {
      throw invalidReference();
    }

    const updated = await this.repository.update(userId, budgetId, updatedInput, requestId);
    if (!updated) throw notFound();
    return updated;
  }

  private async requireBudgetPlanModel(userId: string, budgetId: string): Promise<void> {
    const policy = this.planModelPolicy;
    if (policy) await policy.requireModel(userId, budgetId, 1);
  }

  async initializeReferenceTemplate(userId: string, budgetId: string, requestId?: string) {
    const accessible = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!accessible) throw notFound();
    const role = accessible.workspace.memberships[0]?.role;
    if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
    await this.requireBudgetPlanModel(userId, budgetId);

    const result = await this.repository.initializeReferenceTemplate(userId, budgetId, requestId);
    if (!result) throw notFound();
    return result;
  }
}

function mergeSettings(current: BudgetView, input: UpdateBudgetInput): BudgetSettingsUpdate {
  const incomeAllocationRuleEnabled =
    input.incomeAllocationRuleEnabled ?? current.incomeAllocationRuleEnabled;

  return {
    name: input.name ?? current.name,
    timezone: input.timezone ?? current.timezone,
    cycleStartDay: input.cycleStartDay ?? current.cycleStartDay,
    periodBoundaryOffset: input.periodBoundaryOffset ?? current.periodBoundaryOffset,
    allowNegativeBalance: input.allowNegativeBalance ?? current.allowNegativeBalance,
    incomeAllocationRuleEnabled,
    incomeAllocationSourceCategoryId: incomeAllocationRuleEnabled
      ? (input.incomeAllocationSourceCategoryId ?? current.incomeAllocationSourceCategoryId)
      : null,
    incomeAllocationTargetEnvelopeId: incomeAllocationRuleEnabled
      ? (input.incomeAllocationTargetEnvelopeId ?? current.incomeAllocationTargetEnvelopeId)
      : null,
  };
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', detail: 'Недостаточно прав для действия.' });
}
