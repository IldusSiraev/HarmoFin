import {
  CURRENT_LEGAL_DOCUMENTS,
  assertCurrentConsents,
  pendingConsents,
  type ConsentInput,
} from './legal-documents.js';
import type { LegalConsentRepository } from './legal-consent.repository.js';
import type { AcceptConsentsInput } from './legal.schemas.js';

export class LegalConsentApplicationService {
  constructor(
    private readonly repository: LegalConsentRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  currentDocuments() {
    return CURRENT_LEGAL_DOCUMENTS.map((doc) => ({ ...doc }));
  }

  async accept(
    userId: string,
    input: AcceptConsentsInput,
    meta: { requestId?: string },
  ): Promise<void> {
    assertCurrentConsents(input.consents);
    const now = this.clock();
    await this.repository.transaction(async (tx) => {
      await this.repository.recordConsents(tx, userId, input.consents, now);
      await this.repository.audit(tx, userId, input.consents, meta.requestId);
    });
  }

  pendingFor(userId: string): Promise<ConsentInput[]> {
    return this.repository.transaction(async (tx) =>
      pendingConsents(await this.repository.findAccepted(tx, userId)),
    );
  }
}
