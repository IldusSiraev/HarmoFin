import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ConsentInput } from './legal-documents.js';

type Tx = Prisma.TransactionClient;

export class LegalConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  /** Idempotent: an already accepted version is skipped by the unique index. */
  async recordConsents(tx: Tx, userId: string, consents: ConsentInput[], now: Date): Promise<void> {
    await tx.userConsent.createMany({
      data: consents.map((consent) => ({
        id: createUuidV7(now),
        userId,
        document: consent.document,
        version: consent.version,
        acceptedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  findAccepted(tx: Tx, userId: string): Promise<ConsentInput[]> {
    return tx.userConsent.findMany({ where: { userId }, select: { document: true, version: true } });
  }

  async audit(tx: Tx, userId: string, consents: ConsentInput[], requestId?: string): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: 'auth',
        entityId: userId,
        action: 'LEGAL_CONSENT_ACCEPTED',
        newValues: { consents },
        source: 'API',
        requestId: requestId ?? null,
      },
    });
  }
}
