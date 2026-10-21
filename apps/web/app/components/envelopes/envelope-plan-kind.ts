import { Sparkles } from '@lucide/vue';

import { formatMinorUnits } from '../finance/money-format.js';
import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';
import { ENVELOPE_TYPE_ICONS } from './envelope-type.js';

// Presentation helpers for Envelope Plan v2.2 envelopes. Amounts stay minor
// strings from the server; these helpers only classify or re-format text.

export const PLAN_SCOPE_LABELS: Record<string, string> = {
  CURRENT_EXPENSES: 'На текущие траты',
  SAVINGS_GOAL: 'Накопления',
  RESERVE: 'Резерв',
  MANDATORY_EXPENSES: 'Обязательные платежи',
  CUSTOM: 'Свой конверт',
};

export const PLAN_SLOT_LABELS: Record<string, string> = {
  FIRST: 'Первая половина',
  SECOND: 'Вторая половина',
};

export const PLAN_GROUPS: ReadonlyArray<{ title: string; types: ReadonlyArray<string> }> = [
  { title: 'На период', types: ['CURRENT_EXPENSES'] },
  { title: 'Обязательные', types: ['MANDATORY_EXPENSES'] },
  { title: 'Накопления', types: ['SAVINGS_GOAL', 'RESERVE'] },
  { title: 'Другое', types: ['CUSTOM'] },
];

export function planIcon(envelope: Pick<EnvelopePlanDto, 'envelopeType'>): typeof Sparkles {
  return (
    (ENVELOPE_TYPE_ICONS as Record<string, typeof Sparkles>)[envelope.envelopeType] ?? Sparkles
  );
}

export type EnvelopeTone = 'current' | 'mandatory' | 'savings' | 'reserve' | 'custom';

const TONES: Record<string, EnvelopeTone> = {
  CURRENT_EXPENSES: 'current',
  MANDATORY_EXPENSES: 'mandatory',
  SAVINGS_GOAL: 'savings',
  RESERVE: 'reserve',
};

// Tone drives only the type icon tile and progress fill (Calm Fintech §«Цвет
// типов конвертов»); unknown types fall back to the neutral "custom" tone.
export function envelopeTone(envelopeType: string): EnvelopeTone {
  return TONES[envelopeType] ?? 'custom';
}

export function planScopeNote(envelopeType: string): string {
  if (envelopeType === 'SAVINGS_GOAL' || envelopeType === 'RESERVE') {
    return 'Остаток не сбрасывается при смене периода';
  }
  if (envelopeType === 'MANDATORY_EXPENSES') {
    return 'Аренда, кредиты, коммунальные и другие регулярные платежи';
  }
  if (envelopeType === 'CURRENT_EXPENSES') {
    return 'Остаток прошлого периода переносится только по вашему решению';
  }
  return 'Деньги на любую цель без привязки к периоду';
}

export type BalanceSign = 'negative' | 'zero' | 'positive';

// Sign of a minor-units string without converting it to a number.
export function balanceSign(minor: string): BalanceSign {
  if (minor.startsWith('-')) return /[1-9]/.test(minor) ? 'negative' : 'zero';
  return /[1-9]/.test(minor) ? 'positive' : 'zero';
}

// Minor-units string -> decimal text for an input ("2800000" -> "28000.00").
export function toDecimalText(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(-2)}`;
}

export function formatMoneyText(minor: string): string {
  return formatMinorUnits(minor, 'RUB', 2);
}

// The API returns an envelope's goal (targetAmountMinor) as decimal rubles
// ("5000", "5000.5"), unlike funded/spent/balance, which are minor units.
// String-only conversion to a minor-units string; no floating point.
export function decimalToMinor(decimal: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) return null;
  const digits = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return digits;
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

function plainDateParts(value: string): { day: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { day: Number(match[3]), month };
}

// "2026-10-24" -> "24 октября" (plain calendar date, no year, no timezone shift).
export function formatDayMonth(value: string): string {
  const parts = plainDateParts(value);
  if (!parts) return value;
  return `${parts.day} ${MONTHS_GENITIVE[parts.month - 1]}`;
}

// Period dates for a heading: "10–24 октября" or "25 октября – 9 ноября".
export function periodRangeText(start: string, end: string): string {
  const from = plainDateParts(start);
  const to = plainDateParts(end);
  if (!from || !to) return `${start} – ${end}`;
  if (from.month === to.month) {
    return `${from.day}–${to.day} ${MONTHS_GENITIVE[to.month - 1]}`;
  }
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}
