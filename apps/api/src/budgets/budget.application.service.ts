import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { BudgetAccessPolicy } from '../common/policies/budget-access.policy.js';
import { BudgetRepository, type BudgetView } from './budget.repository.js';

@Injectable()
export class BudgetApplicationService {
  private readonly access = new BudgetAccessPolicy();

  constructor(private readonly repository: BudgetRepository) {}

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
    if (!this.access.canManageBudgetSettings({ userId, role: membership.role, isCreator: false })) {
      throw forbidden();
    }
    return this.repository.create(userId, workspaceId, input, requestId);
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', detail: 'Недостаточно прав для действия.' });
}
