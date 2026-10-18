import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  SCOPE_COVERED_TABLES,
  USER_OWNED_TABLES,
  USER_RETAINED_OUTSIDE_SCOPE,
} from './account-purge.js';

/**
 * Guards the delete-order list in account-purge.ts against schema drift: every model that
 * carries a budget_id/workspace_id column, and every model with a relation to User, must be
 * explicitly classified here. A newly added model that isn't classified fails this test instead
 * of silently surviving a purge or being silently over-deleted from another owner's scope.
 */
describe('account purge coverage', () => {
  const models = Prisma.dmmf.datamodel.models;

  it('covers every model with a budget_id or workspace_id column', () => {
    const uncovered: string[] = [];
    for (const model of models) {
      const hasScopeColumn = model.fields.some(
        (field) =>
          field.kind === 'scalar' && (field.name === 'budgetId' || field.name === 'workspaceId'),
      );
      if (!hasScopeColumn) continue;
      const table = model.dbName ?? model.name;
      // The Budget/Workspace models themselves are the scope, not scoped by their own id column.
      if (table === 'budgets' || table === 'workspaces') continue;
      if (!SCOPE_COVERED_TABLES.has(table)) uncovered.push(`${model.name} -> ${table}`);
    }
    expect(uncovered).toEqual([]);
  });

  it('classifies every model with a relation to User as user-owned, scope-covered, or explicitly retained', () => {
    const unclassified: string[] = [];
    for (const model of models) {
      const hasUserRelation = model.fields.some(
        (field) => field.kind === 'object' && field.type === 'User',
      );
      if (!hasUserRelation) continue;
      const table = model.dbName ?? model.name;
      const classified =
        (USER_OWNED_TABLES as readonly string[]).includes(table) ||
        SCOPE_COVERED_TABLES.has(table) ||
        table in USER_RETAINED_OUTSIDE_SCOPE;
      if (!classified) unclassified.push(`${model.name} -> ${table}`);
    }
    expect(unclassified).toEqual([]);
  });

  it('documents a one-line reason for every table retained outside the owned scope', () => {
    for (const reason of Object.values(USER_RETAINED_OUTSIDE_SCOPE)) {
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).not.toContain('\n');
    }
  });
});
