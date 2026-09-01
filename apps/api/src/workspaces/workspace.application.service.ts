import { Injectable } from '@nestjs/common';

import { WorkspaceRepository, type WorkspaceWithBudget } from './workspace.repository.js';

@Injectable()
export class WorkspaceApplicationService {
  constructor(private readonly repository: WorkspaceRepository) {}

  list(userId: string) {
    return this.repository.findAccessible(userId);
  }

  create(
    userId: string,
    input: { workspaceName: string; budgetName: string },
    requestId?: string,
  ): Promise<WorkspaceWithBudget> {
    return this.repository.createWithFirstBudget(userId, input, requestId);
  }
}
