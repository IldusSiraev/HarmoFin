import type { CategoryType, EnvelopeType, FundingRuleType, PeriodSlot } from '@prisma/client';

import { DEFAULT_CATEGORIES } from './default-categories.js';

export type TemplateRole = 'FIRST' | 'SECOND' | 'MANDATORY' | 'SAVINGS';
export type TemplateStatus = 'EXISTING' | 'MISSING' | 'ARCHIVED' | 'COLLISION';
export type TemplateAction = 'CREATE' | 'ADOPT' | 'SKIP';
export type TemplateMatch = 'KEY' | 'NAME';

export interface V2EnvelopeTemplate {
  role: TemplateRole;
  templateKey: string;
  /** Keys of earlier template revisions that the same logical element may carry. */
  legacyKeys: readonly string[];
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: PeriodSlot | null;
  displayOrder: number;
  suggestedRuleType: FundingRuleType;
  suggestedRulePriority: number;
  /** Savings are offered by choice; base elements are proposed by default. */
  selectable: boolean;
}

/**
 * Base v2 envelope template: FIRST/SECOND period envelopes, mandatory expenses and optional
 * savings by choice. There is deliberately no FREE_MONEY envelope: free money is a computed
 * quantity, not an envelope.
 */
export const V2_ENVELOPE_TEMPLATES: readonly V2EnvelopeTemplate[] = [
  {
    role: 'FIRST',
    templateKey: 'v2-period-first',
    legacyKeys: ['envelope-current-10-24'],
    name: 'Первый период',
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: 'FIRST',
    displayOrder: 0,
    suggestedRuleType: 'FIXED_PER_PERIOD',
    suggestedRulePriority: 20,
    selectable: false,
  },
  {
    role: 'SECOND',
    templateKey: 'v2-period-second',
    legacyKeys: ['envelope-current-25-9'],
    name: 'Второй период',
    envelopeType: 'CURRENT_EXPENSES',
    periodSlot: 'SECOND',
    displayOrder: 1,
    suggestedRuleType: 'FIXED_PER_PERIOD',
    suggestedRulePriority: 30,
    selectable: false,
  },
  {
    role: 'MANDATORY',
    templateKey: 'v2-mandatory',
    legacyKeys: ['envelope-mandatory'],
    name: 'Обязательные',
    envelopeType: 'MANDATORY_EXPENSES',
    periodSlot: null,
    displayOrder: 2,
    suggestedRuleType: 'SUM_OF_PLANS',
    suggestedRulePriority: 10,
    selectable: false,
  },
  {
    role: 'SAVINGS',
    templateKey: 'v2-savings-car',
    legacyKeys: ['envelope-car'],
    name: 'Автомобиль',
    envelopeType: 'SAVINGS_GOAL',
    periodSlot: null,
    displayOrder: 3,
    suggestedRuleType: 'MANUAL',
    suggestedRulePriority: 40,
    selectable: true,
  },
  {
    role: 'SAVINGS',
    templateKey: 'v2-savings-vacation',
    legacyKeys: ['envelope-vacation'],
    name: 'Отпуск',
    envelopeType: 'SAVINGS_GOAL',
    periodSlot: null,
    displayOrder: 4,
    suggestedRuleType: 'MANUAL',
    suggestedRulePriority: 50,
    selectable: true,
  },
];

/** Default categories reused from the v1 descriptors (same keys, names, types, hierarchy). */
export const V2_TEMPLATE_CATEGORIES = DEFAULT_CATEGORIES;

/** Deterministic key for a consented replacement of an archived template envelope (R06 reuses it). */
export function replacementTemplateKey(role: TemplateRole, archivedId: string): string {
  return `v2-replacement-${role.toLowerCase()}-${archivedId}`;
}

export interface TemplateEnvelopeRow {
  id: string;
  templateKey: string | null;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: PeriodSlot | null;
  archivedAt: Date | null;
}

export interface TemplateCategoryRow {
  id: string;
  templateKey: string | null;
  name: string;
  categoryType: CategoryType;
  archivedAt: Date | null;
}

export interface CategoryMatch {
  status: TemplateStatus;
  matchedBy: TemplateMatch | null;
  existingId: string | null;
  existingName: string | null;
  archivedId: string | null;
  collisionId: string | null;
  suggestedAction: TemplateAction;
  requiresConsent: boolean;
}

export interface EnvelopeMatch extends CategoryMatch {
  replacementTemplateKey: string | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function envelopeCompatible(definition: V2EnvelopeTemplate, row: TemplateEnvelopeRow): boolean {
  return row.envelopeType === definition.envelopeType && row.periodSlot === definition.periodSlot;
}

/**
 * Pure matching of one template envelope against the budget's envelopes: template key first
 * (renamed rows keep matching), then compatible name + type + period role. A same-named row of an
 * incompatible type or period role is a COLLISION, never silently accepted. An archived keyed row
 * is shown as ARCHIVED and only a consented CREATE (with a replacement key) is suggested.
 */
export function matchEnvelope(
  definition: V2EnvelopeTemplate,
  rows: readonly TemplateEnvelopeRow[],
): EnvelopeMatch {
  const keys = new Set([definition.templateKey, ...definition.legacyKeys]);
  const active = rows.filter((row) => row.archivedAt === null);
  const archivedKeyed = rows.find(
    (row) => row.archivedAt !== null && keys.has(row.templateKey ?? ''),
  );
  const base = {
    matchedBy: null,
    existingId: null,
    existingName: null,
    archivedId: archivedKeyed?.id ?? null,
    collisionId: null,
    requiresConsent: false,
    replacementTemplateKey: null,
  } as const;

  const byKey = active.find((row) => keys.has(row.templateKey ?? ''));
  if (byKey) {
    if (envelopeCompatible(definition, byKey)) {
      return {
        ...base,
        status: 'EXISTING',
        matchedBy: 'KEY',
        existingId: byKey.id,
        existingName: byKey.name,
        suggestedAction: 'ADOPT',
      };
    }
    return { ...base, status: 'COLLISION', collisionId: byKey.id, suggestedAction: 'SKIP' };
  }
  const named = active.filter((row) => sameName(row.name, definition.name));
  const byName = named.find((row) => envelopeCompatible(definition, row));
  if (byName) {
    return {
      ...base,
      status: 'EXISTING',
      matchedBy: 'NAME',
      existingId: byName.id,
      existingName: byName.name,
      suggestedAction: 'ADOPT',
    };
  }
  const clash = named[0];
  if (clash) {
    return { ...base, status: 'COLLISION', collisionId: clash.id, suggestedAction: 'SKIP' };
  }
  // A period slot admits one active envelope (envelopes_active_period_slot_key): an unmatched
  // active holder (no key, different name) makes creating the template row impossible.
  const slotHolder = definition.periodSlot
    ? active.find((row) => row.periodSlot === definition.periodSlot)
    : undefined;
  if (slotHolder) {
    return { ...base, status: 'COLLISION', collisionId: slotHolder.id, suggestedAction: 'SKIP' };
  }
  if (archivedKeyed) {
    return {
      ...base,
      status: 'ARCHIVED',
      suggestedAction: 'CREATE',
      requiresConsent: true,
      replacementTemplateKey: replacementTemplateKey(definition.role, archivedKeyed.id),
    };
  }
  return { ...base, status: 'MISSING', suggestedAction: 'CREATE' };
}

/** Pure matching of one default category (reuses the v1 category descriptors). */
export function matchCategory(
  definition: { templateKey: string; name: string; categoryType: CategoryType },
  rows: readonly TemplateCategoryRow[],
): CategoryMatch {
  const active = rows.filter((row) => row.archivedAt === null);
  const archivedKeyed = rows.find(
    (row) => row.archivedAt !== null && row.templateKey === definition.templateKey,
  );
  const base = {
    matchedBy: null,
    existingId: null,
    existingName: null,
    archivedId: archivedKeyed?.id ?? null,
    collisionId: null,
    requiresConsent: false,
  } as const;

  const byKey = active.find((row) => row.templateKey === definition.templateKey);
  if (byKey) {
    if (byKey.categoryType === definition.categoryType) {
      return {
        ...base,
        status: 'EXISTING',
        matchedBy: 'KEY',
        existingId: byKey.id,
        existingName: byKey.name,
        suggestedAction: 'ADOPT',
      };
    }
    return { ...base, status: 'COLLISION', collisionId: byKey.id, suggestedAction: 'SKIP' };
  }
  const named = active.filter((row) => sameName(row.name, definition.name));
  const byName = named.find((row) => row.categoryType === definition.categoryType);
  if (byName) {
    return {
      ...base,
      status: 'EXISTING',
      matchedBy: 'NAME',
      existingId: byName.id,
      existingName: byName.name,
      suggestedAction: 'ADOPT',
    };
  }
  const clash = named[0];
  if (clash) {
    return { ...base, status: 'COLLISION', collisionId: clash.id, suggestedAction: 'SKIP' };
  }
  if (archivedKeyed) {
    return { ...base, status: 'ARCHIVED', suggestedAction: 'CREATE', requiresConsent: true };
  }
  return { ...base, status: 'MISSING', suggestedAction: 'CREATE' };
}
