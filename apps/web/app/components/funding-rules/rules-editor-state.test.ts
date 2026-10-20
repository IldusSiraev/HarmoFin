import { describe, expect, it } from 'vitest';

import {
  FIELD_TEXT,
  buildRequest,
  buildState,
  mapServerErrors,
  move,
  setType,
  snapshotOf,
  updateCard,
} from './rules-editor-state.js';

const envelopes = [
  { id: 'a', name: 'Еда', envelopeType: 'CURRENT_EXPENSES', archivedAt: null },
  { id: 'b', name: 'Подушка', envelopeType: 'SAVINGS_GOAL', archivedAt: null },
  { id: 'c', name: 'Аптека', envelopeType: 'CUSTOM', archivedAt: null },
  { id: 'm', name: 'Обязательные', envelopeType: 'MANDATORY_EXPENSES', archivedAt: null },
  { id: 'z', name: 'Архив', envelopeType: 'CUSTOM', archivedAt: '2026-01-01T00:00:00Z' },
];
const rules = [
  {
    id: 'r0',
    envelopeId: 'c',
    type: 'MANUAL' as const,
    priority: 0,
    fixedAmountMinor: null,
    percentBasisPoints: null,
  },
  {
    id: 'r1',
    envelopeId: 'm',
    type: 'SUM_OF_PLANS' as const,
    priority: 10,
    fixedAmountMinor: null,
    percentBasisPoints: null,
  },
  {
    id: 'r2',
    envelopeId: 'a',
    type: 'FIXED_PER_PERIOD' as const,
    priority: 20,
    fixedAmountMinor: '1500000',
    percentBasisPoints: null,
  },
  {
    id: 'r3',
    envelopeId: 'z',
    type: 'PERCENT_OF_INCOME' as const,
    priority: 30,
    fixedAmountMinor: null,
    percentBasisPoints: 100,
  },
];
const suggestion = { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' };

const initial = () => buildState(envelopes, rules, suggestion);
const ids = (cards: Array<{ envelopeId: string }>) => cards.map((card) => card.envelopeId);

describe('rules-editor-state', () => {
  it('строит очередь из не-MANUAL правил активных конвертов, остальное — вне очереди по имени', () => {
    const state = initial();
    expect(ids(state.queue)).toEqual(['m', 'a']);
    expect(ids(state.outside)).toEqual(['c', 'b']);
    expect(state.queue[1]).toMatchObject({ type: 'FIXED_PER_PERIOD', fixed: '15000.00' });
    expect(state.outside.find((card) => card.envelopeId === 'b')?.type).toBe('');
    expect(state.suggestion).toEqual({
      enabled: true,
      sourceCategoryId: 'cat',
      targetEnvelopeId: 'b',
    });
  });

  it('тип определяет зону', () => {
    let state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    expect(ids(state.queue)).toEqual(['m', 'a', 'b']);
    expect(ids(state.outside)).toEqual(['c']);
    state = setType(state, 'm', 'MANUAL');
    expect(ids(state.queue)).toEqual(['a', 'b']);
    expect(ids(state.outside)).toEqual(['c', 'm']);
    state = setType(state, 'a', 'SUGGESTED_FIXED');
    expect(ids(state.queue)).toEqual(['a', 'b']);
  });

  it('move переставляет только внутри очереди и ограничивает индекс', () => {
    const state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    expect(ids(move(state, 0, 2).queue)).toEqual(['a', 'b', 'm']);
    expect(ids(move(state, 2, 0).queue)).toEqual(['b', 'm', 'a']);
    expect(move(state, 0, -1)).toBe(state);
    expect(move(state, 2, 3)).toBe(state);
  });

  it('snapshot меняется только при изменении', () => {
    const base = snapshotOf(initial());
    expect(snapshotOf(initial())).toBe(base);
    expect(snapshotOf(updateCard(initial(), 'a', { fixed: '1' }))).not.toBe(base);
  });

  it('buildRequest: тело по типам, конверты без типа не передаются', () => {
    let state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    state = updateCard(state, 'b', { percent: '12,5' });
    state = updateCard(state, 'a', { fixed: '15000,5' });
    const result = buildRequest(state);
    expect(result.body).toEqual({
      queue: [
        { envelopeId: 'm', type: 'SUM_OF_PLANS' },
        { envelopeId: 'a', type: 'FIXED_PER_PERIOD', fixedAmount: '15000.5' },
        { envelopeId: 'b', type: 'PERCENT_OF_INCOME', percentBasisPoints: 1250 },
      ],
      outside: [{ envelopeId: 'c', type: 'MANUAL' }],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
  });

  it('buildRequest: ошибки формы у карточки и у предложения', () => {
    let state = updateCard(initial(), 'a', { fixed: '0' });
    state = {
      ...state,
      suggestion: { enabled: true, sourceCategoryId: '', targetEnvelopeId: 'b' },
    };
    const result = buildRequest(state);
    expect(result.body).toBeNull();
    expect(result.cardErrors).toEqual({ a: { fixedAmount: FIELD_TEXT.fixedAmount } });
    expect(result.suggestionErrors.sourceCategoryId).toBeDefined();
  });

  it('buildRequest: выключенное предложение отправляет категорию и конверт как null', () => {
    const state = {
      ...initial(),
      suggestion: { enabled: false, sourceCategoryId: 'cat', targetEnvelopeId: 'env' },
    };
    expect(buildRequest(state).body?.incomeSuggestion).toEqual({
      enabled: false,
      sourceCategoryId: null,
      targetEnvelopeId: null,
    });
  });

  it('mapServerErrors сопоставляет путь с конвертом отправленного тела', () => {
    const body = buildRequest(initial()).body!;
    const mapped = mapServerErrors(body, [
      { field: 'queue.1.fixedAmount' },
      { field: 'queue.0.envelopeId' },
      { field: 'outside.0.type' },
      { field: 'incomeSuggestion.targetEnvelopeId' },
    ]);
    expect(mapped.matched).toBe(true);
    expect(mapped.cardErrors).toEqual({
      a: { fixedAmount: FIELD_TEXT.fixedAmount },
      m: { type: FIELD_TEXT.type },
      c: { type: FIELD_TEXT.type },
    });
    expect(mapped.suggestionErrors.targetEnvelopeId).toBeDefined();
    expect(mapServerErrors(body, [{ field: 'something' }]).matched).toBe(false);
  });
});
