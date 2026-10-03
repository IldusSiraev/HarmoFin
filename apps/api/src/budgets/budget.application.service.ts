import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { RolePolicy } from '../common/policies/role-policy.js';
import { BudgetRepository, type BudgetView } from './budget.repository.js';

@Injectable()
export class BudgetApplicationService {
  constructor(
    private readonly repository: BudgetRepository,
    private readonly rolePolicy: RolePolicy,
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
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', detail: 'Недостаточно прав для действия.' });
}
