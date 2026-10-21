import type { FundingRuleResponse, FundingRuleType } from '../../composables/useEnvelopePlanV2.js';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';

export const RULE_TYPE_LABELS: Record<FundingRuleType, string> = {
  MANUAL: 'Вручную',
  SUM_OF_PLANS: 'Сумма планов обязательных',
  FIXED_PER_PERIOD: 'Фиксированная цель на период',
  SUGGESTED_FIXED: 'Предлагаемая сумма',
  PERCENT_OF_INCOME: 'Процент от дохода',
};

export const RULE_TYPE_HINTS: Record<FundingRuleType, string> = {
  MANUAL: 'Приложение ничего не предлагает: сумму вы вводите сами, когда распределяете доход.',
  SUM_OF_PLANS:
    'Приложение сложит запланированные обязательные платежи и предложит отложить столько, сколько ещё не хватает.',
  FIXED_PER_PERIOD:
    'Каждый период приложение предлагает отложить одну и ту же сумму. Эту цель вы подтверждаете сами.',
  SUGGESTED_FIXED:
    'Приложение предлагает отложить эту сумму из дохода. Это подсказка, а не обязательный взнос.',
  PERCENT_OF_INCOME:
    'Приложение предлагает отложить указанную долю от каждого поступившего дохода.',
};

export const QUEUE_HINT =
  'Когда приходит доход, приложение предлагает разложить его по конвертам сверху вниз: сначала первый, потом следующий, пока хватает денег. Окончательное решение всегда за вами.';
export const OUTSIDE_HINT =
  'Для этих конвертов приложение ничего не предлагает: пополняйте их вручную, когда распределяете доход.';
export const SUGGESTION_HINT =
  'Когда приходит доход выбранной категории, приложение предложит целиком направить его в выбранный конверт. Деньги не переводятся сами: вы подтверждаете распределение.';

export const QUEUE_SUBTITLE = 'Сначала заполняется правило №1, затем следующее.';
export const OUTSIDE_SUBTITLE = 'Эти конверты не получают автоматического предложения.';
export const SUGGESTION_SUBTITLE = 'Выберите, какой доход предлагать направить в конверт.';

const ALL_TYPES: FundingRuleType[] = [
  'MANUAL',
  'SUM_OF_PLANS',
  'FIXED_PER_PERIOD',
  'SUGGESTED_FIXED',
  'PERCENT_OF_INCOME',
];

/** The server allows SUM_OF_PLANS only for the mandatory envelope. */
export function ruleTypeOptions(envelopeType: string): FundingRuleType[] {
  return envelopeType === 'MANDATORY_EXPENSES'
    ? ALL_TYPES
    : ALL_TYPES.filter((type) => type !== 'SUM_OF_PLANS');
}

const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

// Basis points <-> percent text, as integer/string conversion of the input only.
export function basisPointsToPercent(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

export function percentToBasisPoints(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return basisPoints <= 10_000 ? basisPoints : null;
}

/**
 * Read-only summary of an envelope's rule. `rules` must be in the server order
 * (priority, then envelope id); the queue number counts only non-MANUAL rules.
 * Returns null when the rules could not be loaded.
 */
export function describeRule(
  envelopeId: string,
  rules: FundingRuleResponse[] | null,
): string | null {
  if (rules === null) return null;
  const rule = rules.find((item) => item.envelopeId === envelopeId);
  if (!rule) return 'Правило не задано';
  if (rule.type === 'MANUAL') return RULE_TYPE_LABELS.MANUAL;
  let text = RULE_TYPE_LABELS[rule.type];
  if (rule.fixedAmountMinor !== null) text += `, ${formatMoneyText(rule.fixedAmountMinor)}`;
  if (rule.percentBasisPoints !== null) {
    text += `, ${basisPointsToPercent(rule.percentBasisPoints)} %`;
  }
  const position = rules
    .filter((item) => item.type !== 'MANUAL')
    .findIndex((item) => item.envelopeId === envelopeId);
  return `${text} · №${position + 1} в очереди`;
}
