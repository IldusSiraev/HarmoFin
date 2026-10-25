import { computed, type ComputedRef } from 'vue';

import {
  useAuth,
  type BudgetSummary,
  type WorkspaceMembership,
  type WorkspaceRole,
} from './useAuth.js';

// Picks the workspace the server marked active (`activeWorkspaceId`), not just
// the first entry in the list — a member can belong to more than one
// workspace with family access. Every page/composable that used to read the
// first list entry directly reads through here instead, so switching
// workspaces updates every one of them from a single source.
export function useActiveWorkspace(): {
  workspace: ComputedRef<WorkspaceMembership | null>;
  budget: ComputedRef<BudgetSummary | null>;
  budgetId: ComputedRef<string | undefined>;
  role: ComputedRef<WorkspaceRole | null>;
  isCreator: ComputedRef<boolean>;
  workspaces: ComputedRef<WorkspaceMembership[]>;
} {
  const { currentData } = useAuth();

  const workspaces = computed<WorkspaceMembership[]>(() => currentData.value?.workspaces ?? []);
  const workspace = computed<WorkspaceMembership | null>(() => {
    const list = workspaces.value;
    const activeId = currentData.value?.activeWorkspaceId;
    return list.find((item) => item.id === activeId) ?? list[0] ?? null;
  });
  const budget = computed<BudgetSummary | null>(() => workspace.value?.budgets[0] ?? null);

  return {
    workspaces,
    workspace,
    budget,
    budgetId: computed(() => budget.value?.id),
    role: computed(() => workspace.value?.role ?? null),
    isCreator: computed(() => workspace.value?.isCreator ?? false),
  };
}
