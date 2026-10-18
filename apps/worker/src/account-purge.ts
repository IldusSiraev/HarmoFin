import { Prisma } from '@prisma/client';

/**
 * Children before parents: every FK is ON DELETE RESTRICT. Order mirrors
 * docs/runbooks/budget-reset.sql, except audit_events are deleted, not detached.
 * Legacy model-1 tables (transfer_parts, income_allocations, envelope_reallocations) are included.
 */
export const BUDGET_TABLES_IN_DELETE_ORDER = [
  'plan_payments',
  'notifications',
  'envelope_assignments',
  'envelope_movements',
  'envelope_periods',
  'envelope_funding_rules',
  'envelope_reallocations',
  'income_allocations',
  'transfer_parts',
  'transfers',
  'plan_occurrences',
  'regular_plans',
  'transactions',
  'idempotency_records',
  'audit_events',
  'budget_cycle_revisions',
  'envelopes',
] as const;

/** Deleted in the same budget_id scope, outside the ordered list above (leaf cleanup, then accounts). */
export const BUDGET_SCOPE_EXTRA_TABLES = ['categories', 'accounts'] as const;

/** Owned-workspace scope: deleted by workspace_id for the workspaces this user owns. */
export const WORKSPACE_SCOPE_TABLES = ['notifications', 'audit_events', 'workspace_memberships'] as const;

export const BUDGETS_TABLE = 'budgets';
export const WORKSPACES_TABLE = 'workspaces';

/** Deleted directly by the user's own id (their own sessions/tokens/memberships). */
export const USER_OWNED_TABLES = ['sessions', 'recovery_tokens', 'workspace_memberships'] as const;

/**
 * Tables that have a user-id column but are intentionally NOT blanket-deleted by that column:
 * rows outside this user's owned workspace/budget scope belong to another owner and must survive
 * (collaboration/audit history). Rows inside the owned scope are already removed above.
 */
export const USER_RETAINED_OUTSIDE_SCOPE: Record<string, string> = {
  idempotency_records:
    'actor_user_id rows outside the owned budget scope belong to another owner and are retained.',
  audit_events:
    'actor_user_id rows outside the owned workspace/budget scope are another owner\'s audit trail and are retained; ' +
    'account-scoped rows (workspace_id IS NULL AND budget_id IS NULL, e.g. RECOVERY_REQUESTED/PASSWORD_CHANGED) are ' +
    "deleted below by actor_user_id since they belong to no other owner's scope.",
  notifications:
    'user_id rows outside the owned workspace/budget scope belong to another owner\'s workspace and are retained.',
};

/** Every table a budget_id/workspace_id-scoped row is guaranteed to be removed from. */
export const SCOPE_COVERED_TABLES: ReadonlySet<string> = new Set<string>([
  ...BUDGET_TABLES_IN_DELETE_ORDER,
  ...BUDGET_SCOPE_EXTRA_TABLES,
  ...WORKSPACE_SCOPE_TABLES,
  BUDGETS_TABLE,
  WORKSPACES_TABLE,
]);

export class AccountPurgeCoverageError extends Error {
  override readonly name = 'AccountPurgeCoverageError';

  constructor(readonly tableName: string) {
    super(`Table ${tableName} still holds rows of a purged scope.`);
  }
}

/** Physically deletes everything the user owns and anonymizes the user row. Run inside one transaction. */
export async function purgeUserData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const workspaceIds = (
    await tx.workspace.findMany({ where: { ownerId: userId }, select: { id: true } })
  ).map((workspace) => workspace.id);
  const budgetIds =
    workspaceIds.length === 0
      ? []
      : (
          await tx.budget.findMany({
            where: { workspaceId: { in: workspaceIds } },
            select: { id: true },
          })
        ).map((budget) => budget.id);

  if (budgetIds.length > 0) {
    await tx.$executeRaw`
      UPDATE "budgets"
      SET "income_allocation_source_category_id" = NULL, "income_allocation_target_envelope_id" = NULL
      WHERE "id" = ANY(${budgetIds}::uuid[])`;
    for (const table of BUDGET_TABLES_IN_DELETE_ORDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "budget_id" = ANY($1::uuid[])`, budgetIds);
    }
    // categories reference their parent with ON DELETE RESTRICT: delete leaves layer by layer.
    for (;;) {
      const deleted = await tx.$executeRaw`
        DELETE FROM "categories" c
        WHERE c."budget_id" = ANY(${budgetIds}::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM "categories" ch WHERE ch."budget_id" = c."budget_id" AND ch."parent_id" = c."id"
          )`;
      if (deleted === 0) break;
    }
    await tx.$executeRaw`DELETE FROM "accounts" WHERE "budget_id" = ANY(${budgetIds}::uuid[])`;
    await assertNoRowsLeft(tx, 'budget_id', budgetIds);
    await tx.$executeRaw`DELETE FROM "budgets" WHERE "id" = ANY(${budgetIds}::uuid[])`;
  }

  if (workspaceIds.length > 0) {
    await tx.$executeRaw`DELETE FROM "notifications" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM "audit_events" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM "workspace_memberships" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await assertNoRowsLeft(tx, 'workspace_id', workspaceIds);
    await tx.$executeRaw`DELETE FROM "workspaces" WHERE "id" = ANY(${workspaceIds}::uuid[])`;
  }

  // Only delete rows the deleted user actually owns (their own sessions/tokens/memberships).
  // Do NOT delete idempotency_records/notifications by actor_user_id/user_id here: those tables
  // also hold rows created while this user acted inside *another* owner's workspace/budget (once
  // collaboration exists), and that history is not this user's to erase. Rows inside the scope
  // this user owns are already removed by the budget_id/workspace_id deletes above; the users
  // row stays (anonymized), so any remaining FK to it stays valid.
  await tx.$executeRaw`DELETE FROM "sessions" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "recovery_tokens" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "workspace_memberships" WHERE "user_id" = ${userId}::uuid`;
  // Account-level audit events (auth actions written with no workspace/budget, e.g.
  // RECOVERY_REQUESTED, PASSWORD_CHANGED before a membership existed) belong to no other owner's
  // scope, so they are safe and necessary to delete by actor_user_id here.
  await tx.$executeRaw`
    DELETE FROM "audit_events"
    WHERE "actor_user_id" = ${userId}::uuid AND "workspace_id" IS NULL AND "budget_id" IS NULL`;
  await tx.$executeRaw`
    UPDATE "users"
    SET "email" = 'deleted-' || "id"::text || '@invalid',
        "password_hash" = '',
        "display_name" = NULL,
        "email_verified_at" = NULL,
        "status" = 'DELETED',
        "updated_at" = now()
    WHERE "id" = ${userId}::uuid`;
}

/** Guard against a new table silently surviving the purge: every table with the column must be empty for the scope. */
async function assertNoRowsLeft(
  tx: Prisma.TransactionClient,
  column: 'budget_id' | 'workspace_id',
  ids: string[],
): Promise<void> {
  const tables = await tx.$queryRaw<Array<{ tableName: string }>>`
    SELECT DISTINCT c.table_name AS "tableName"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND c.column_name = ${column} AND t.table_type = 'BASE TABLE'`;
  for (const { tableName } of tables) {
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await tx.$queryRawUnsafe<Array<{ remaining: bigint }>>(
      `SELECT count(*) AS "remaining" FROM ${quoted} WHERE "${column}" = ANY($1::uuid[])`,
      ids,
    );
    if ((rows[0]?.remaining ?? 0n) > 0n) throw new AccountPurgeCoverageError(tableName);
  }
}
