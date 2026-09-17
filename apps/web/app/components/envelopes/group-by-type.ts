import type {
  EnvelopeDto,
  EnvelopeSummaryDto,
  EnvelopeType,
} from '../../composables/useBudgetReferenceData.js';

// The same order the API returns byType in; keeping it here too means a list
// without a summary still reads in the expected order.
const TYPE_ORDER = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
] as const satisfies ReadonlyArray<EnvelopeType>;

const TYPE_LABELS: Record<EnvelopeType, string> = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
};

export interface EnvelopeGroup {
  envelopeType: EnvelopeType;
  label: string;
  totalMinor: string | null;
  items: EnvelopeDto[];
}

export function groupByType(
  envelopes: ReadonlyArray<EnvelopeDto>,
  summary: EnvelopeSummaryDto | null,
): EnvelopeGroup[] {
  return TYPE_ORDER.flatMap((envelopeType) => {
    const items = envelopes
      .filter((envelope) => envelope.envelopeType === envelopeType)
      .sort((left, right) => left.displayOrder - right.displayOrder);
    if (items.length === 0) return [];
    const group = summary?.byType.find((entry) => entry.envelopeType === envelopeType);
    return [
      {
        envelopeType,
        label: TYPE_LABELS[envelopeType],
        totalMinor: group?.totalMinor ?? null,
        items,
      },
    ];
  });
}
