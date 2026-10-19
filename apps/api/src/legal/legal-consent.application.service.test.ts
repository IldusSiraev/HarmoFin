import { describe, expect, it, vi } from 'vitest';

import { CURRENT_LEGAL_DOCUMENTS } from './legal-documents.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');
const current = CURRENT_LEGAL_DOCUMENTS.map(({ document, version }) => ({ document, version }));

function setup() {
  const tx = {};
  const repository = {
    transaction: vi.fn((callback: (t: unknown) => unknown) => callback(tx)),
    recordConsents: vi.fn().mockResolvedValue(undefined),
    findAccepted: vi.fn().mockResolvedValue([]),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  const service = new LegalConsentApplicationService(repository as never, () => NOW);
  return { service, repository, tx };
}

describe('LegalConsentApplicationService', () => {
  it('records the current set and audits it in one transaction', async () => {
    const { service, repository, tx } = setup();

    await service.accept('u1', { consents: current }, { requestId: 'r1' });

    expect(repository.recordConsents).toHaveBeenCalledWith(tx, 'u1', current, NOW);
    expect(repository.audit).toHaveBeenCalledWith(tx, 'u1', current, 'r1');
  });

  it('rejects an outdated set before touching the database', async () => {
    const { service, repository } = setup();

    await expect(
      service.accept('u1', { consents: [{ document: 'TERMS', version: '2020-01-01' }] }, {}),
    ).rejects.toMatchObject({ response: { code: 'LEGAL_CONSENT_VERSION_MISMATCH' } });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('lists the documents the user still has to accept', async () => {
    const { service, repository } = setup();
    repository.findAccepted.mockResolvedValue([{ document: 'TERMS', version: '2026-10-18' }]);

    await expect(service.pendingFor('u1')).resolves.toEqual(current.slice(1));
  });
});
