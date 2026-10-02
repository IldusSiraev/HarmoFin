import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { formatMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  LegacyAssignmentHistoryRepository,
  type LegacyAssignmentRow,
} from './legacy-assignment-history.repository.js';
import {
  encodeLegacyAssignmentCursor,
  type LegacyAssignmentHistoryQuery,
} from './legacy-assignment-history.schemas.js';

export type LegacyAssignmentHistoryItem = Omit<LegacyAssignmentRow, 'amountMinor'> & {
  amountMinor: string;
};

export type LegacyAssignmentHistoryPage = {
  items: LegacyAssignmentHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class LegacyAssignmentHistoryApplicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly repository: LegacyAssignmentHistoryRepository,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  /**
   * OWNER-only archive of v1 assignment rows of a model-2 budget. Membership, model and role are
   * checked (404/409/403) before the history query; the cursor must belong to this budget (400).
   * The whole read runs in one read-only snapshot and never touches v2 funded or balance data.
   */
  async list(
    userId: string,
    budgetId: string,
    query: LegacyAssignmentHistoryQuery,
  ): Promise<LegacyAssignmentHistoryPage> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const budget = await this.repository.findAccessibleBudget(tx, userId, budgetId);
        if (!budget) throw resourceNotFound();
        const role = await this.repository.findActiveRole(tx, budget.workspaceId, userId);
        if (role !== 'OWNER') throw forbidden();
        if (query.cursor && query.cursor.budgetId !== budgetId) {
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            detail: 'Проверьте корректность полей запроса.',
            fieldErrors: [
              { field: 'cursor', message: 'Курсор выдан для другого бюджета.', code: 'custom' },
            ],
          });
        }
        const rows = await this.repository.page(tx, budgetId, query.cursor, query.limit + 1);
        const hasMore = rows.length > query.limit;
        const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
        const last = pageRows[pageRows.length - 1];
        return {
          items: pageRows.map((row) => ({
            ...row,
            amountMinor: formatMinorUnits(row.amountMinor),
          })),
          nextCursor:
            hasMore && last
              ? encodeLegacyAssignmentCursor({
                  budgetId,
                  occurredOn: last.occurredOn,
                  sourceKind: last.sourceKind,
                  id: last.id,
                })
              : null,
          hasMore,
        };
      },
      { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
