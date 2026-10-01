import { createHash } from 'node:crypto';

/** Bump when the template definitions change so older previews become stale. */
export const V2_TEMPLATE_VERSION = 'v2.2-1';

/**
 * Everything the template preview (R05) and apply (R06) depend on: current elements and settings.
 * Derived suggestions are a pure function of it and intentionally excluded.
 */
export type TemplatePreviewState = {
  templateVersion: string;
  budgetId: string;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  categories: Array<{
    id: string;
    templateKey: string | null;
    name: string;
    categoryType: string;
    parentId: string | null;
    archived: boolean;
  }>;
  envelopes: Array<{
    id: string;
    templateKey: string | null;
    name: string;
    envelopeType: string;
    periodSlot: string | null;
    archived: boolean;
  }>;
  rules: Array<{
    envelopeId: string;
    type: string;
    priority: number;
    fixedMinor: bigint | null;
    percentBasisPoints: number | null;
  }>;
};

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)] as const),
    );
  }
  return value;
}

function sortedByJson<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: JSON.stringify(canonicalize(item)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ item }) => item);
}

export function canonicalTemplateStateJson(state: TemplatePreviewState): string {
  return JSON.stringify(
    canonicalize({
      ...state,
      categories: sortedByJson(state.categories),
      envelopes: sortedByJson(state.envelopes),
      rules: sortedByJson(state.rules),
    }),
  );
}

/** sha256 hex of the canonical state; R06 apply recomputes it under the budget lock. */
export function computeTemplatePreviewHash(state: TemplatePreviewState): string {
  return createHash('sha256').update(canonicalTemplateStateJson(state)).digest('hex');
}
