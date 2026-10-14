import { describe, expect, it } from 'vitest';

import {
  V2_ENVELOPE_TEMPLATES,
  matchEnvelope,
  replacementTemplateKey,
  type TemplateEnvelopeRow,
} from './v2-template.definitions.js';
import { type TemplatePreviewState, computeTemplatePreviewHash } from './v2-template.state.js';

const first = V2_ENVELOPE_TEMPLATES.find((item) => item.role === 'FIRST')!;
const row = (patch: Partial<TemplateEnvelopeRow>): TemplateEnvelopeRow => ({
  id: 'id-1',
  templateKey: null,
  name: 'x',
  envelopeType: 'CURRENT_EXPENSES',
  periodSlot: 'FIRST',
  archivedAt: null,
  ...patch,
});

describe('v2 template definitions', () => {
  it('никогда не содержит FREE_MONEY, ключи уникальны', () => {
    expect(V2_ENVELOPE_TEMPLATES.some((item) => item.envelopeType === 'FREE_MONEY')).toBe(false);
    expect(new Set(V2_ENVELOPE_TEMPLATES.map((item) => item.templateKey)).size).toBe(
      V2_ENVELOPE_TEMPLATES.length,
    );
  });

  it('сопоставление: ключ раньше имени, коллизия, архив', () => {
    const renamed = row({ templateKey: first.templateKey, name: 'Утро' });
    expect(matchEnvelope(first, [renamed])).toMatchObject({ status: 'EXISTING', matchedBy: 'KEY' });
    expect(matchEnvelope(first, [row({ name: 'первый период ' })])).toMatchObject({
      status: 'EXISTING',
      matchedBy: 'NAME',
    });
    expect(
      matchEnvelope(first, [
        row({ name: 'Первый период', envelopeType: 'SAVINGS_GOAL', periodSlot: null }),
      ]),
    ).toMatchObject({ status: 'COLLISION', suggestedAction: 'SKIP' });
    const archived = matchEnvelope(first, [
      row({ id: 'abc', templateKey: first.templateKey, archivedAt: new Date() }),
    ]);
    expect(archived).toMatchObject({
      status: 'ARCHIVED',
      requiresConsent: true,
      replacementTemplateKey: replacementTemplateKey('FIRST', 'abc'),
    });
    expect(matchEnvelope(first, [])).toMatchObject({ status: 'MISSING' });
  });

  it('хеш не зависит от порядка и меняется от состояния', () => {
    const state: TemplatePreviewState = {
      templateVersion: 'v',
      budgetId: 'b',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
      categories: [],
      envelopes: [
        {
          id: 'a',
          templateKey: null,
          name: 'A',
          envelopeType: 'CUSTOM',
          periodSlot: null,
          archived: false,
        },
        {
          id: 'b',
          templateKey: null,
          name: 'B',
          envelopeType: 'CUSTOM',
          periodSlot: null,
          archived: false,
        },
      ],
      rules: [],
    };
    const reordered = { ...state, envelopes: [...state.envelopes].reverse() };
    expect(computeTemplatePreviewHash(reordered)).toBe(computeTemplatePreviewHash(state));
    expect(computeTemplatePreviewHash({ ...state, cycleStartDay: 2 })).not.toBe(
      computeTemplatePreviewHash(state),
    );
  });
});
