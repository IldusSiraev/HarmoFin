import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  legal: {
    operatorName: 'Иванов Иван Иванович',
    operatorInn: '123456789012',
    operatorEmail: 'privacy@harmofin.example',
    hostingProvider: 'Хостинг',
    emailProvider: 'Почта',
  },
}));
const request = vi.hoisted(() => vi.fn());

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: runtime }) }));
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useLegal } from './useLegal.js';

describe('useLegal', () => {
  it('exposes the operator and treats a 12-digit INN with all fields as complete', () => {
    const { operator, operatorComplete } = useLegal();
    expect(operator.value.name).toBe('Иванов Иван Иванович');
    expect(operatorComplete.value).toBe(true);
  });

  it('flags missing or malformed requisites', () => {
    runtime.legal.operatorInn = '1234';
    expect(useLegal().operatorComplete.value).toBe(false);
    runtime.legal.operatorInn = '123456789012';
    runtime.legal.operatorEmail = '';
    expect(useLegal().operatorComplete.value).toBe(false);
  });

  it('loads current document versions from the API', async () => {
    request.mockResolvedValue([
      { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
    ]);
    await expect(useLegal().loadDocuments()).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/api/v1/legal/documents');
  });
});
