import { Landmark, PiggyBank, ShieldCheck, ShoppingCart, Sparkles } from '@lucide/vue';

// Icons by Envelope Plan v2.2 envelope type; unknown types fall back to the
// caller's default.
export const ENVELOPE_TYPE_ICONS: Record<string, typeof Landmark> = {
  CURRENT_EXPENSES: ShoppingCart,
  MANDATORY_EXPENSES: Landmark,
  SAVINGS_GOAL: PiggyBank,
  RESERVE: ShieldCheck,
  CUSTOM: Sparkles,
};

const ENVELOPE_TYPE_LABELS: Record<string, string> = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
};

const PERIOD_SLOT_LABELS: Record<string, string> = {
  FIRST: 'Первая половина',
  SECOND: 'Вторая половина',
};

// "Текущие расходы · Первая половина": type label plus the period slot when there is one.
export function envelopeSubtitle(envelope: {
  envelopeType: string;
  periodSlot: string | null;
}): string {
  return [
    ENVELOPE_TYPE_LABELS[envelope.envelopeType],
    envelope.periodSlot === null ? null : PERIOD_SLOT_LABELS[envelope.periodSlot],
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
