import { Landmark, PiggyBank, ShieldCheck, ShoppingCart, Sparkles, Wallet } from '@lucide/vue';

import type {
  EnvelopeDto,
  EnvelopeType,
  PeriodSlot,
} from '../../composables/useBudgetReferenceData.js';

export const ENVELOPE_TYPE_LABELS: Record<EnvelopeType, string> = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
};

export const ENVELOPE_TYPE_ICONS: Record<EnvelopeType, typeof Landmark> = {
  CURRENT_EXPENSES: ShoppingCart,
  MANDATORY_EXPENSES: Landmark,
  SAVINGS_GOAL: PiggyBank,
  RESERVE: ShieldCheck,
  FREE_MONEY: Wallet,
  CUSTOM: Sparkles,
};

export const PERIOD_SLOT_LABELS: Record<PeriodSlot, string> = {
  FIRST: 'Первая половина',
  SECOND: 'Вторая половина',
};

export function envelopeSubtitle(
  envelope: Pick<EnvelopeDto, 'envelopeType' | 'periodSlot'>,
): string {
  return [
    ENVELOPE_TYPE_LABELS[envelope.envelopeType],
    envelope.periodSlot === null ? null : PERIOD_SLOT_LABELS[envelope.periodSlot],
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
