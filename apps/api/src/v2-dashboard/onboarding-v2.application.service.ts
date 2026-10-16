import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { OnboardingV2Repository } from './onboarding-v2.repository.js';

const DECLINE_MANDATORY_PLANS_OPERATION = 'DECLINE_MANDATORY_PLANS';
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class OnboardingV2ApplicationService {
  private readonly rolePolicy = new RolePolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly idempotency: IdempotencyService,
    private readonly repository: OnboardingV2Repository,
  ) {}

  /** Records once that the budget has no mandatory payments. Moves no money. */
  async declineMandatoryPlans(
    userId: string,
    budgetId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<void> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256').update(JSON.stringify({ budgetId })).digest('hex');

    await this.prisma.$transaction(
      (tx) =>
        this.idempotency.execute(
          tx,
          {
            budgetId,
            actorUserId: userId,
            key: idempotencyKey,
            operation: DECLINE_MANDATORY_PLANS_OPERATION,
            requestHash,
          },
          async () => {
            const role = await this.repository.memberRole(tx, model.workspaceId, userId);
            if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
            const declinedAt = new Date();
            const changed = await this.repository.declineMandatoryPlans(
              tx,
              budgetId,
              model.workspaceId,
              declinedAt,
            );
            if (changed) {
              await this.repository.recordDeclined(tx, {
                budgetId,
                workspaceId: model.workspaceId,
                actorUserId: userId,
                requestId,
                declinedAt,
              });
            }
            return { status: 204, body: {} };
          },
        ),
      TX_OPTIONS,
    );
  }
}
