import { Prisma } from '@prisma/client';

import type {
  LegacyAssignmentCursor,
  LegacyAssignmentSourceKind,
} from './legacy-assignment-history.schemas.js';

export type LegacyAssignmentRow = {
  sourceKind: LegacyAssignmentSourceKind;
  id: string;
  occurredOn: string;
  amountMinor: bigint;
  status: 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  isDeleted: boolean;
  isEnvelopeArchived: boolean;
  envelopeId: string | null;
  sourceEnvelopeId: string | null;
  destinationEnvelopeId: string | null;
  incomeTransactionId: string | null;
  categoryId: string | null;
  accountId: string | null;
};

type RawRow = {
  source_kind: LegacyAssignmentSourceKind;
  id: string;
  occurred_on: string;
  amount_minor: bigint;
  status: LegacyAssignmentRow['status'];
  is_deleted: boolean;
  is_envelope_archived: boolean;
  envelope_id: string | null;
  source_envelope_id: string | null;
  destination_envelope_id: string | null;
  income_transaction_id: string | null;
  category_id: string | null;
  account_id: string | null;
};

/**
 * Read-only archive of the v1 assignment semantics (income allocations, envelope reallocations,
 * envelope starting balances). Every source table is filtered by budget_id in its own SELECT; the
 * rows are normalised into one list ordered by (occurred_on, source_kind, id) with the byte-wise
 * "C" collation so the keyset cursor is deterministic. Logically deleted, cancelled and archived
 * records are included and marked. Nothing here feeds any v2 funded or balance calculation.
 */
export class LegacyAssignmentHistoryRepository {
  /** Active membership role of the user in the workspace, or null. */
  async findActiveRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<string | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /** Active budget of an active workspace the user is an active member of. */
  async findAccessibleBudget(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
  ): Promise<{ id: string; workspaceId: string } | null> {
    return tx.budget.findFirst({
      where: {
        id: budgetId,
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE', memberships: { some: { userId, isActive: true } } },
      },
      select: { id: true, workspaceId: true },
    });
  }

  async page(
    tx: Prisma.TransactionClient,
    budgetId: string,
    cursor: LegacyAssignmentCursor | undefined,
    take: number,
  ): Promise<LegacyAssignmentRow[]> {
    const after = cursor
      ? Prisma.sql`WHERE (
          u.sort_date > ${cursor.occurredOn}::date
          OR (u.sort_date = ${cursor.occurredOn}::date
              AND u.source_kind COLLATE "C" > ${cursor.sourceKind}::text COLLATE "C")
          OR (u.sort_date = ${cursor.occurredOn}::date
              AND u.source_kind COLLATE "C" = ${cursor.sourceKind}::text COLLATE "C"
              AND u.id > ${cursor.id}::uuid)
        )`
      : Prisma.empty;
    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT u.* FROM (
        SELECT 'LEGACY_ALLOCATION'::text AS source_kind,
               a."id" AS id,
               to_char(a."occurred_on", 'YYYY-MM-DD') AS occurred_on,
               a."occurred_on" AS sort_date,
               a."amount_minor" AS amount_minor,
               a."status"::text AS status,
               (a."deleted_at" IS NOT NULL) AS is_deleted,
               (e."archived_at" IS NOT NULL) AS is_envelope_archived,
               a."envelope_id" AS envelope_id,
               NULL::uuid AS source_envelope_id,
               NULL::uuid AS destination_envelope_id,
               a."income_transaction_id" AS income_transaction_id,
               t."category_id" AS category_id,
               a."account_id" AS account_id
        FROM "income_allocations" a
        JOIN "envelopes" e ON e."id" = a."envelope_id" AND e."budget_id" = a."budget_id"
        JOIN "transactions" t ON t."id" = a."income_transaction_id" AND t."budget_id" = a."budget_id"
        WHERE a."budget_id" = ${budgetId}::uuid
        UNION ALL
        SELECT 'LEGACY_REALLOCATION'::text,
               r."id",
               to_char(r."occurred_on", 'YYYY-MM-DD'),
               r."occurred_on",
               r."amount_minor",
               r."status"::text,
               (r."deleted_at" IS NOT NULL),
               (src."archived_at" IS NOT NULL OR dst."archived_at" IS NOT NULL),
               NULL::uuid,
               r."source_envelope_id",
               r."destination_envelope_id",
               NULL::uuid,
               NULL::uuid,
               NULL::uuid
        FROM "envelope_reallocations" r
        JOIN "envelopes" src ON src."id" = r."source_envelope_id" AND src."budget_id" = r."budget_id"
        JOIN "envelopes" dst
          ON dst."id" = r."destination_envelope_id" AND dst."budget_id" = r."budget_id"
        WHERE r."budget_id" = ${budgetId}::uuid
        UNION ALL
        SELECT 'LEGACY_ENVELOPE_START'::text,
               v."id",
               to_char((v."created_at" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
               (v."created_at" AT TIME ZONE 'UTC')::date,
               v."starting_balance_minor",
               'CONFIRMED'::text,
               FALSE,
               (v."archived_at" IS NOT NULL),
               v."id",
               NULL::uuid,
               NULL::uuid,
               NULL::uuid,
               NULL::uuid,
               NULL::uuid
        FROM "envelopes" v
        WHERE v."budget_id" = ${budgetId}::uuid AND v."starting_balance_minor" <> 0
      ) u
      ${after}
      ORDER BY u.sort_date, u.source_kind COLLATE "C", u.id
      LIMIT ${take}
    `;
    return rows.map((row) => ({
      sourceKind: row.source_kind,
      id: row.id,
      occurredOn: row.occurred_on,
      amountMinor: row.amount_minor,
      status: row.status,
      isDeleted: row.is_deleted,
      isEnvelopeArchived: row.is_envelope_archived,
      envelopeId: row.envelope_id,
      sourceEnvelopeId: row.source_envelope_id,
      destinationEnvelopeId: row.destination_envelope_id,
      incomeTransactionId: row.income_transaction_id,
      categoryId: row.category_id,
      accountId: row.account_id,
    }));
  }
}
