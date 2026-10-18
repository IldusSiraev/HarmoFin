import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_DOCUMENTS,
  assertCurrentConsents,
  pendingConsents,
} from './legal-documents.js';

const current = CURRENT_LEGAL_DOCUMENTS.map(({ document, version }) => ({ document, version }));

describe('legal documents', () => {
  it('pins the current versions so a change is a deliberate, reviewed edit', () => {
    expect(CURRENT_LEGAL_DOCUMENTS).toEqual([
      { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
    ]);
  });

  it('accepts exactly the current set in any order', () => {
    expect(() => assertCurrentConsents([...current].reverse())).not.toThrow();
  });

  it.each([
    ['a missing document', current.slice(0, 2)],
    ['an outdated version', [{ document: 'TERMS', version: '2020-01-01' }, ...current.slice(1)]],
    ['a duplicate document', [current[0]!, current[0]!, current[1]!]],
    ['an extra entry', [...current, current[0]!]],
  ])('rejects %s', (_label, consents) => {
    expect(() => assertCurrentConsents(consents as never)).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'LEGAL_CONSENT_VERSION_MISMATCH' }),
      }),
    );
  });

  it('lists current documents without an accepted current version', () => {
    expect(pendingConsents([])).toEqual(current);
    expect(pendingConsents(current)).toEqual([]);
    expect(
      pendingConsents([
        { document: 'TERMS', version: '2020-01-01' },
        { document: 'PRIVACY_POLICY', version: '2026-10-18' },
        { document: 'PD_CONSENT', version: '2026-10-18' },
      ]),
    ).toEqual([{ document: 'TERMS', version: '2026-10-18' }]);
  });
});
