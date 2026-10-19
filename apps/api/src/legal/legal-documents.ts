import { UnprocessableEntityException } from '@nestjs/common';
import type { LegalDocumentType } from '@prisma/client';

export type ConsentInput = { document: LegalDocumentType; version: string };

/**
 * Single source of truth for the current legal document editions. Bump a version together with
 * the text in apps/web/app/components/legal and its hash (docs/runbooks/public-launch-legal.md).
 */
export const CURRENT_LEGAL_DOCUMENTS: ReadonlyArray<{
  document: LegalDocumentType;
  version: string;
  effectiveOn: string;
}> = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

/** The consent set must name every current document exactly once at its current version. */
export function assertCurrentConsents(consents: ConsentInput[]): void {
  const matches =
    consents.length === CURRENT_LEGAL_DOCUMENTS.length &&
    new Set(consents.map((consent) => consent.document)).size === consents.length &&
    CURRENT_LEGAL_DOCUMENTS.every((current) =>
      consents.some(
        (consent) => consent.document === current.document && consent.version === current.version,
      ),
    );
  if (!matches)
    throw new UnprocessableEntityException({
      code: 'LEGAL_CONSENT_VERSION_MISMATCH',
      detail: 'Документы обновились. Обновите страницу и примите актуальные редакции.',
    });
}

export function pendingConsents(
  accepted: ConsentInput[],
  current = CURRENT_LEGAL_DOCUMENTS,
): ConsentInput[] {
  return current
    .filter(
      (doc) =>
        !accepted.some((row) => row.document === doc.document && row.version === doc.version),
    )
    .map(({ document, version }) => ({ document, version }));
}
