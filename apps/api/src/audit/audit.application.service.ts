import { Injectable } from '@nestjs/common';

import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { AuditRepository } from './audit.repository.js';

export type AuditEventView = {
  id: string;
  createdAt: string;
  actor: { id: string; displayName: string | null; email: string } | null;
  entityType: string;
  entityId: string | null;
  action: string;
  source: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
};

@Injectable()
export class AuditApplicationService {
  constructor(private readonly repository: AuditRepository) {}

  async listForTransaction(
    userId: string,
    budgetId: string,
    transactionId: string,
  ): Promise<{ items: AuditEventView[] }> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (budget.workspace.memberships[0]?.role !== 'OWNER') throw forbidden();
    const transaction = await this.repository.findAccessibleTransaction(
      userId,
      budgetId,
      transactionId,
    );
    if (!transaction) throw resourceNotFound();
    const events = await this.repository.listForTransaction(budgetId, transactionId);
    return {
      items: events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt.toISOString(),
        actor: event.actor,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        source: event.source,
        oldValues: event.oldValues as Record<string, unknown> | null,
        newValues: event.newValues as Record<string, unknown> | null,
      })),
    };
  }
}
