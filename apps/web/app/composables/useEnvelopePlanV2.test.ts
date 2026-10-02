import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createApiClient, createCsrfStore } from './useApiClient.js';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => state.client };
});

import { useEnvelopePlanV2 } from './useEnvelopePlanV2.js';

const budgetId = '0190a000-0000-7000-8000-000000000001';
const base = `/api/v2/budgets/${budgetId}`;
const apiUrl = 'http://api.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useEnvelopePlanV2', () => {
  let fetchSpy: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
  let csrfReads: number;

  beforeEach(() => {
    csrfReads = 0;
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/v1/auth/csrf')) {
        csrfReads += 1;
        return json({ csrfToken: `csrf-${csrfReads}` });
      }
      return json({ ok: true });
    });
    state.client = createApiClient(fetchSpy, apiUrl, 'http://web.test', createCsrfStore());
  });

  function lastCall(): { url: string; init: RequestInit; headers: Headers } {
    const call = fetchSpy.mock.calls.filter(
      ([input]) => !String(input).endsWith('/api/v1/auth/csrf'),
    );
    const [url, init] = call[call.length - 1] as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
  }

  it('previews funding with CSRF but without Idempotency-Key', async () => {
    const api = useEnvelopePlanV2();
    const body = {
      sourceKind: 'INCOME' as const,
      incomeTransactionId: 'tx-1',
      overrides: [{ envelopeId: 'e-1', amount: '1500.50' }],
    };
    await api.previewFunding(budgetId, body);

    const { url, init, headers } = lastCall();
    expect(url).toBe(`${apiUrl}${base}/funding/preview`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(headers.has('Idempotency-Key')).toBe(false);
  });

  it('confirms funding with the supplied Idempotency-Key and reuses it on retry', async () => {
    const api = useEnvelopePlanV2();
    const body = {
      sourceKind: 'INCOME' as const,
      incomeTransactionId: 'tx-1',
      previewHash: 'a'.repeat(64),
      confirmPeriodTargets: [],
      lines: [{ envelopeId: 'e-1', amount: '100.00' }],
    };
    const key = 'attempt-key-1';

    fetchSpy.mockImplementationOnce(async () => json({ csrfToken: 'csrf-x' }));
    fetchSpy.mockImplementationOnce(async () => {
      throw new TypeError('network down');
    });
    await expect(api.confirmFunding(budgetId, body, key)).rejects.toThrow('network down');
    const first = lastCall();

    await api.confirmFunding(budgetId, body, key);
    const second = lastCall();

    expect(first.url).toBe(`${apiUrl}${base}/funding/confirm`);
    expect(second.url).toBe(first.url);
    expect(first.headers.get('Idempotency-Key')).toBe(key);
    expect(second.headers.get('Idempotency-Key')).toBe(key);
    expect(JSON.parse(second.init.body as string)).toEqual(body);
  });

  it('shares one CSRF token across calls through the api client store', async () => {
    const api = useEnvelopePlanV2();
    await api.previewFunding(budgetId, { sourceKind: 'FREE' });
    await api.assignFree(budgetId, { envelopeId: 'e-1', amount: '10' }, 'k-1');
    expect(csrfReads).toBe(1);
  });

  it('assignFree and move post to assignments and movements with keys', async () => {
    const api = useEnvelopePlanV2();
    await api.assignFree(budgetId, { envelopeId: 'e-1', amount: '10.5' }, 'k-assign');
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/assignments`);
    expect(JSON.parse(call.init.body as string)).toEqual({
      envelopeId: 'e-1',
      amount: '10.5',
      sourceKind: 'FREE',
    });
    expect(call.headers.get('Idempotency-Key')).toBe('k-assign');

    await api.move(
      budgetId,
      { sourceEnvelopeId: 'e-1', destinationEnvelopeId: 'e-2', amount: '5' },
      'k-move',
    );
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/movements`);
    expect(call.headers.get('Idempotency-Key')).toBe('k-move');
  });

  it('payObligation posts to the occurrence pay path', async () => {
    const api = useEnvelopePlanV2();
    await api.payObligation(
      budgetId,
      'occ-1',
      {
        accountId: 'a-1',
        categoryId: 'c-1',
        amount: '99.90',
        occurredOn: '2026-10-02',
        willPayMore: false,
      },
      'k-pay',
    );
    const call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/obligations/occ-1/pay`);
    expect(call.headers.get('Idempotency-Key')).toBe('k-pay');
  });

  it('reads without CSRF or Idempotency-Key and builds query strings', async () => {
    const api = useEnvelopePlanV2();
    await api.getDashboard(budgetId, '2026-10-02');
    expect(lastCall().url).toBe(`${apiUrl}${base}/dashboard?asOf=2026-10-02`);
    await api.getDashboard(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/dashboard`);
    await api.getTemplatePreview(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/reference-template/preview`);
    await api.listEnvelopes(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/envelopes`);
    await api.listObligationPlans(budgetId, 'all');
    expect(lastCall().url).toBe(`${apiUrl}${base}/obligations/plans?status=all`);
    await api.listIncomePlans(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/income-plans`);
    await api.listIncomeOccurrences(budgetId, { status: 'DUE', from: '2026-10-01' });
    expect(lastCall().url).toBe(
      `${apiUrl}${base}/income-plans/occurrences?status=DUE&from=2026-10-01`,
    );
    expect(lastCall().headers.has('X-CSRF-Token')).toBe(false);
    expect(csrfReads).toBe(0);
  });

  it('keeps keys on remaining mutations at their v2 paths', async () => {
    const api = useEnvelopePlanV2();
    const cases: Array<[Promise<unknown>, string, string]> = [
      [
        api.applyTemplate(
          budgetId,
          {
            previewHash: 'b'.repeat(64),
            periods: [
              { role: 'FIRST', action: 'CREATE' },
              { role: 'SECOND', action: 'CREATE' },
            ],
            mandatory: { action: 'CREATE' },
            savings: [],
          },
          'k1',
        ),
        '/reference-template/apply',
        'k1',
      ],
      [
        api.createTransaction(
          budgetId,
          {
            transactionType: 'EXPENSE',
            status: 'CONFIRMED',
            amount: '10',
            occurredOn: '2026-10-02',
            accountId: 'a',
            categoryId: 'c',
          },
          'k2',
        ),
        '/transactions',
        'k2',
      ],
      [
        api.createTransfer(
          budgetId,
          {
            sourceAccountId: 'a',
            destinationAccountId: 'b',
            amount: '10',
            occurredOn: '2026-10-02',
          },
          'k3',
        ),
        '/transfers',
        'k3',
      ],
      [
        api.createObligationPlan(
          budgetId,
          {
            name: 'Аренда',
            amount: '10',
            scheduledOn: '2026-10-05',
            categoryId: 'c',
            recurrence: 'MONTHLY',
          },
          'k4',
        ),
        '/obligations/plans',
        'k4',
      ],
      [
        api.payOneTimeObligation(
          budgetId,
          {
            name: 'Разовый',
            plannedAmount: '10',
            actualAmount: '9',
            occurredOn: '2026-10-02',
            accountId: 'a',
            categoryId: 'c',
          },
          'k5',
        ),
        '/obligations/one-time-pay',
        'k5',
      ],
      [
        api.createIncomePlan(
          budgetId,
          {
            name: 'Зарплата',
            amount: '10',
            scheduledOn: '2026-10-05',
            categoryId: 'c',
            recurrence: 'MONTHLY',
          },
          'k6',
        ),
        '/income-plans',
        'k6',
      ],
      [
        api.recordIncomeOccurrence(
          budgetId,
          'occ-9',
          { accountId: 'a', amount: '10', occurredOn: '2026-10-02' },
          'k7',
        ),
        '/income-plans/occurrences/occ-9/record',
        'k7',
      ],
    ];
    for (const [promise, path, key] of cases) {
      await promise;
      const call = fetchSpy.mock.calls.find(
        ([input, init]) =>
          String(input) === `${apiUrl}${base}${path}` &&
          new Headers((init as RequestInit).headers).get('Idempotency-Key') === key,
      );
      expect(call, `${path} with ${key}`).toBeDefined();
    }
  });

  it.each([
    ['confirmPeriodTarget', 'confirm-target'],
    ['rejectPeriodTarget', 'reject-target'],
  ] as const)('%s posts an empty keyed body to the encoded period path', async (method, path) => {
    const api = useEnvelopePlanV2();
    await api[method](budgetId, 'period/id 1', 'key-1');

    const { url, init, headers } = lastCall();
    expect(url).toBe(`${apiUrl}${base}/periods/period%2Fid%201/${path}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(headers.get('Idempotency-Key')).toBe('key-1');
    expect(headers.get('x-csrf-token')).toBe('csrf-1');
  });
});
