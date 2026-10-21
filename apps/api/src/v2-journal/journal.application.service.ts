import { Injectable } from '@nestjs/common';

import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import {
  toJournalItem,
  type TransactionJournalV2Item,
} from '../v2-transactions/transaction-v2.application.service.js';
import {
  toTransferJournalItem,
  type TransferJournalItem,
} from '../v2-transfers/direct-transfer.application.service.js';
import { decodeFeedCursor, encodeFeedCursor } from './journal.cursor.js';
import { mergeNewestFirst, type FeedPosition } from './journal.merge.js';
import { JournalRepository } from './journal.repository.js';
import type { ListJournalInput } from './journal.schemas.js';

export type JournalItem =
  ({ kind: 'TRANSACTION' } & TransactionJournalV2Item) | TransferJournalItem;
export type JournalPage = { items: JournalItem[]; nextCursor: string | null };

const positionOf = (item: JournalItem): FeedPosition => ({
  occurredOn: item.occurredOn,
  createdAt: item.createdAt,
  id: item.id.toLowerCase(),
});

/** Read-only feed of v2 transactions and direct transfers in one order. */
@Injectable()
export class JournalApplicationService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly feed: JournalRepository,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(userId: string, budgetId: string, input: ListJournalInput): Promise<JournalPage> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const budget = await this.transactions.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (input.status === 'DELETED' && budget.workspace.memberships[0]?.role !== 'OWNER') {
      throw forbidden();
    }
    const referencesExist = await this.transactions.validateJournalReferences(budgetId, input);
    if (!referencesExist) throw resourceNotFound();

    const filter = {
      limit: input.limit,
      cursor: input.cursor ? decodeFeedCursor(input.cursor) : null,
      type: input.type,
      status: input.status,
      from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined,
      to: input.to ? new Date(`${input.to}T00:00:00.000Z`) : undefined,
      accountId: input.accountId,
      categoryId: input.categoryId,
      envelopeId: input.envelopeId,
    };
    const [transactionRows, transferRows] = await Promise.all([
      this.feed.transactions(budgetId, filter),
      this.feed.transfers(budgetId, filter),
    ]);
    const links = await this.transactions.findPlanOccurrenceLinks(
      budgetId,
      transactionRows.map((row) => row.id),
    );
    const left: JournalItem[] = transactionRows.map((row) => ({
      kind: 'TRANSACTION' as const,
      ...toJournalItem(row, links.get(row.id) ?? []),
    }));
    const right: JournalItem[] = transferRows.map(toTransferJournalItem);
    const merged = mergeNewestFirst(left, right, positionOf, input.limit + 1);
    const hasNext = merged.length > input.limit;
    const items = merged.slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: hasNext && last ? encodeFeedCursor(positionOf(last)) : null };
  }
}
