import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';

export interface PlanModelReference {
  id: string;
  workspaceId: string;
  planModelVersion: number;
  planModelActivatedOn: Date | null;
}

@Injectable()
export class PlanModelPolicy {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requireModel(
    userId: string,
    budgetId: string,
    version: 1 | 2,
  ): Promise<PlanModelReference> {
    const budget = await this.prisma.budget.findFirst({
      where: {
        id: budgetId,
        status: 'ACTIVE',
        workspace: {
          status: 'ACTIVE',
          memberships: { some: { userId, isActive: true } },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        planModelVersion: true,
        planModelActivatedOn: true,
      },
    });
    if (!budget) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Бюджет не найден или недоступен для этого пользователя.',
      });
    }
    if (budget.planModelVersion !== version) {
      throw new ConflictException({
        code: 'MODEL_VERSION_MISMATCH',
        detail:
          'Бюджет работает на другой версии модели плана. Используйте соответствующую версию API.',
      });
    }
    return {
      id: budget.id,
      workspaceId: budget.workspaceId,
      planModelVersion: budget.planModelVersion,
      planModelActivatedOn: budget.planModelActivatedOn,
    };
  }
}
