import type {
  EnvelopePlanDto,
  FundingRuleResponse,
  FundingRuleType,
  FundingRulesBatchQueueItem,
  IncomeSuggestionState,
  PutFundingRulesBatchRequest,
} from '../../composables/useEnvelopePlanV2.js';
import { toDecimalText } from '../envelopes/envelope-plan-kind.js';
import { basisPointsToPercent, percentToBasisPoints } from './funding-rule-text.js';

// Editing model of the funding rules page. Pure functions over plain data: the
// page keeps one EditorState, every change returns a new one. The browser only
// checks input shape; the server owns every rule and answers with field errors.

export type RuleField = 'type' | 'fixedAmount' | 'percentBasisPoints';

export interface RuleCard {
  envelopeId: string;
  name: string;
  envelopeType: string;
  /** '' — the envelope has no saved rule and none is chosen yet. */
  type: FundingRuleType | '';
  /** Decimal rubles as typed. */
  fixed: string;
  /** Percent as typed. */
  percent: string;
}

export interface SuggestionDraft {
  enabled: boolean;
  /** '' — not chosen. */
  sourceCategoryId: string;
  targetEnvelopeId: string;
}

export interface EditorState {
  queue: RuleCard[];
  outside: RuleCard[];
  suggestion: SuggestionDraft;
}

export type CardErrors = Record<string, Partial<Record<RuleField, string>>>;
export type SuggestionErrors = Partial<Record<'sourceCategoryId' | 'targetEnvelopeId', string>>;

type EnvelopeInput = Pick<EnvelopePlanDto, 'id' | 'name' | 'envelopeType' | 'archivedAt'>;

export const FIELD_TEXT: Record<RuleField, string> = {
  type: 'Проверьте тип правила для этого конверта.',
  fixedAmount: 'Укажите сумму больше нуля, не более двух знаков после запятой.',
  percentBasisPoints: 'Проценты: введите значение от 0 до 100, не более двух знаков после запятой.',
};
const SUGGESTION_TEXT = {
  sourceCategoryId: 'Выберите категорию дохода.',
  targetEnvelopeId: 'Выберите конверт.',
} as const;

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/;

const byName = (left: RuleCard, right: RuleCard) => left.name.localeCompare(right.name, 'ru');
const isQueued = (type: FundingRuleType | '') => type !== '' && type !== 'MANUAL';
const hasFixed = (type: FundingRuleType | '') =>
  type === 'FIXED_PER_PERIOD' || type === 'SUGGESTED_FIXED';

export function buildState(
  envelopes: EnvelopeInput[],
  rules: FundingRuleResponse[],
  suggestion: IncomeSuggestionState,
): EditorState {
  const active = envelopes.filter((envelope) => envelope.archivedAt === null);
  const ruleOf = new Map(rules.map((rule) => [rule.envelopeId, rule]));
  const card = (envelope: EnvelopeInput): RuleCard => {
    const rule = ruleOf.get(envelope.id);
    return {
      envelopeId: envelope.id,
      name: envelope.name,
      envelopeType: envelope.envelopeType,
      type: rule?.type ?? '',
      fixed: rule?.fixedAmountMinor ? toDecimalText(rule.fixedAmountMinor) : '',
      percent: rule?.percentBasisPoints == null ? '' : basisPointsToPercent(rule.percentBasisPoints),
    };
  };
  const activeById = new Map(active.map((envelope) => [envelope.id, envelope]));
  // Server order (priority, then envelope id) is the queue order.
  const queue = rules
    .filter((rule) => rule.type !== 'MANUAL' && activeById.has(rule.envelopeId))
    .map((rule) => card(activeById.get(rule.envelopeId)!));
  const queued = new Set(queue.map((item) => item.envelopeId));
  const outside = active
    .filter((envelope) => !queued.has(envelope.id))
    .map(card)
    .sort(byName);
  return {
    queue,
    outside,
    suggestion: {
      enabled: suggestion.enabled,
      sourceCategoryId: suggestion.sourceCategoryId ?? '',
      targetEnvelopeId: suggestion.targetEnvelopeId ?? '',
    },
  };
}

export function setType(
  state: EditorState,
  envelopeId: string,
  type: FundingRuleType | '',
): EditorState {
  const inQueue = state.queue.find((item) => item.envelopeId === envelopeId);
  const current = inQueue ?? state.outside.find((item) => item.envelopeId === envelopeId);
  if (!current) return state;
  const next: RuleCard = { ...current, type };
  if (!isQueued(type)) {
    return {
      ...state,
      queue: state.queue.filter((item) => item.envelopeId !== envelopeId),
      outside: [...state.outside.filter((item) => item.envelopeId !== envelopeId), next].sort(byName),
    };
  }
  if (inQueue) {
    return {
      ...state,
      queue: state.queue.map((item) => (item.envelopeId === envelopeId ? next : item)),
    };
  }
  return {
    ...state,
    queue: [...state.queue, next],
    outside: state.outside.filter((item) => item.envelopeId !== envelopeId),
  };
}

export function updateCard(
  state: EditorState,
  envelopeId: string,
  patch: Partial<Pick<RuleCard, 'fixed' | 'percent'>>,
): EditorState {
  const apply = (item: RuleCard) => (item.envelopeId === envelopeId ? { ...item, ...patch } : item);
  return { ...state, queue: state.queue.map(apply), outside: state.outside.map(apply) };
}

export function move(state: EditorState, from: number, to: number): EditorState {
  const last = state.queue.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return state;
  const queue = [...state.queue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item!);
  return { ...state, queue };
}

export function snapshotOf(state: EditorState): string {
  return JSON.stringify(state);
}

export function buildRequest(state: EditorState): {
  body: PutFundingRulesBatchRequest | null;
  cardErrors: CardErrors;
  suggestionErrors: SuggestionErrors;
} {
  const cardErrors: CardErrors = {};
  const queue: FundingRulesBatchQueueItem[] = [];
  for (const card of state.queue) {
    const item = { envelopeId: card.envelopeId, type: card.type } as FundingRulesBatchQueueItem;
    if (hasFixed(card.type)) {
      const text = card.fixed.trim();
      if (AMOUNT_PATTERN.test(text) && !ZERO_AMOUNT.test(text)) {
        item.fixedAmount = text.replace(',', '.');
      } else {
        cardErrors[card.envelopeId] = { fixedAmount: FIELD_TEXT.fixedAmount };
      }
    }
    if (card.type === 'PERCENT_OF_INCOME') {
      const basisPoints = percentToBasisPoints(card.percent);
      if (basisPoints === null) {
        cardErrors[card.envelopeId] = { percentBasisPoints: FIELD_TEXT.percentBasisPoints };
      } else {
        item.percentBasisPoints = basisPoints;
      }
    }
    queue.push(item);
  }
  const outside = state.outside
    .filter((card) => card.type === 'MANUAL')
    .map((card) => ({ envelopeId: card.envelopeId, type: 'MANUAL' as const }));

  const { suggestion } = state;
  const suggestionErrors: SuggestionErrors = {};
  if (suggestion.enabled && suggestion.sourceCategoryId === '') {
    suggestionErrors.sourceCategoryId = SUGGESTION_TEXT.sourceCategoryId;
  }
  if (suggestion.enabled && suggestion.targetEnvelopeId === '') {
    suggestionErrors.targetEnvelopeId = SUGGESTION_TEXT.targetEnvelopeId;
  }

  const invalid =
    Object.keys(cardErrors).length > 0 || Object.keys(suggestionErrors).length > 0;
  return {
    body: invalid
      ? null
      : {
          queue,
          outside,
          incomeSuggestion: {
            enabled: suggestion.enabled,
            sourceCategoryId: suggestion.sourceCategoryId || null,
            targetEnvelopeId: suggestion.targetEnvelopeId || null,
          },
        },
    cardErrors,
    suggestionErrors,
  };
}

const RULE_PATH = /^(queue|outside)\.(\d+)\.(envelopeId|type|fixedAmount|percentBasisPoints)$/;
const SUGGESTION_PATH = /^incomeSuggestion\.(sourceCategoryId|targetEnvelopeId)$/;

export function mapServerErrors(
  body: PutFundingRulesBatchRequest,
  fieldErrors: Array<{ field: string }>,
): { cardErrors: CardErrors; suggestionErrors: SuggestionErrors; matched: boolean } {
  const cardErrors: CardErrors = {};
  const suggestionErrors: SuggestionErrors = {};
  let matched = false;
  for (const { field } of fieldErrors) {
    const rule = RULE_PATH.exec(field);
    if (rule) {
      const item = body[rule[1] as 'queue' | 'outside'][Number(rule[2])];
      if (!item) continue;
      const key: RuleField = rule[3] === 'envelopeId' ? 'type' : (rule[3] as RuleField);
      cardErrors[item.envelopeId] = { ...cardErrors[item.envelopeId], [key]: FIELD_TEXT[key] };
      matched = true;
      continue;
    }
    const suggestion = SUGGESTION_PATH.exec(field);
    if (suggestion) {
      const key = suggestion[1] as 'sourceCategoryId' | 'targetEnvelopeId';
      suggestionErrors[key] = SUGGESTION_TEXT[key];
      matched = true;
    }
  }
  return { cardErrors, suggestionErrors, matched };
}
