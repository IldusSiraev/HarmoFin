import { Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { type FundingRuleBody, FundingRuleRepository, toRuleBody } from './funding-rule.repository.js';

/**
 * Funding rules of a whole budget: one read of the queue and one atomic save of the queue
 * order, every envelope rule and the income-category suggestion. Rules are settings: saving
 * them never moves money, never touches assignments, balances or confirmed period targets.
 */
@Injectable()
export class FundingRulesBatchApplicationService {
  private readonly rules = new FundingRuleRepository();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
  ): Promise<{ status: number; body: { items: FundingRuleBody[] } }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const rules = await this.rules.listRules(tx, budgetId);
      return { status: 200, body: { items: rules.map(toRuleBody) } };
    });
  }
}
