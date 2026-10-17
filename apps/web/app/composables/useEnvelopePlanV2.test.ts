import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createApiClient, createCsrfStore } from './useApiClient.js';

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => state.client };
});

import { REPORT_V2_KEYS, useEnvelopePlanV2 } from './useEnvelopePlanV2.js';

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
  it('reads one envelope and its history with encoded ids and the history query', async () => {
    const api = useEnvelopePlanV2();
    await api.getEnvelope(budgetId, 'env/1 a');
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes/env%2F1%20a`);
    expect(call.init.method).toBe('GET');

    await api.getEnvelopeHistory(budgetId, 'env/1 a', {
      cursor: 'c 1',
      limit: '20',
      status: 'DELETED',
    });
    call = lastCall();
    expect(call.url).toBe(
      `${apiUrl}${base}/envelopes/env%2F1%20a/history?cursor=c+1&limit=20&status=DELETED`,
    );
    expect(call.init.method).toBe('GET');

    await api.getEnvelopeHistory(budgetId, 'env-1');
    expect(lastCall().url).toBe(`${apiUrl}${base}/envelopes/env-1/history`);
  });

  it('creates, updates and archives envelopes with CSRF and Idempotency-Key', async () => {
    const api = useEnvelopePlanV2();

    await api.createEnvelope(budgetId, { name: 'Кафе', envelopeType: 'CURRENT_EXPENSES' }, 'k-c');
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body as string)).toEqual({
      name: 'Кафе',
      envelopeType: 'CURRENT_EXPENSES',
    });
    expect(call.headers.get('Idempotency-Key')).toBe('k-c');
    expect(call.headers.get('x-csrf-token')).toBe('csrf-1');

    await api.updateEnvelope(budgetId, 'env/1', { name: 'Новое' }, 'k-u');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes/env%2F1`);
    expect(call.init.method).toBe('PATCH');
    expect(call.init.body).toBe('{"name":"Новое"}');
    expect(call.headers.get('Idempotency-Key')).toBe('k-u');
    expect(call.headers.get('x-csrf-token')).toBe('csrf-1');

    await api.archiveEnvelope(budgetId, 'env/1', 'k-a');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes/env%2F1/archive`);
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('k-a');
    expect(call.headers.get('x-csrf-token')).toBe('csrf-1');
  });

  it('reads v2 reports with GET and no mutation headers', async () => {
    const api = useEnvelopePlanV2();

    await api.getReport(budgetId, 'savings-goals', { to: '2026-09-30', envelopeId: 'e-1' });
    const call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/reports/savings-goals?to=2026-09-30&envelopeId=e-1`);
    expect(call.init.method ?? 'GET').toBe('GET');
    expect(call.headers.get('Idempotency-Key')).toBeNull();

    await api.getReport(budgetId, 'account-balances');
    expect(lastCall().url).toBe(`${apiUrl}${base}/reports/account-balances`);
  });

  it('lists exactly the nine API report keys', () => {
    expect([...REPORT_V2_KEYS]).toEqual([
      'account-balances',
      'expenses-by-category',
      'expenses-by-period',
      'expenses-by-cycle',
      'incomes-by-cycle',
      'net-cash-flow',
      'savings-goals',
      'plan-vs-actual',
      'assignment-movements',
      'envelope-limits',
      'period-comparison',
    ]);
  });

  it('downloads v2 CSV exports as GET blobs', async () => {
    fetchSpy.mockImplementation(
      async () => new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
    );
    const api = useEnvelopePlanV2();

    const blob = await api.exportTransactions(budgetId);
    expect(await blob.text()).toBe('a;b');
    expect(lastCall().url).toBe(`${apiUrl}${base}/exports/transactions.csv`);
    await api.exportAssignments(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/exports/assignments.csv`);
    const call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/exports/assignments.csv`);
    expect(call.init.method ?? 'GET').toBe('GET');
    expect(call.headers.get('x-csrf-token')).toBeNull();
    expect(call.init.credentials).toBe('include');
    expect(call.headers.get('Origin')).toBe('http://web.test');
  });

  it('PUTs funding rule, period target and income suggestion with CSRF and keys', async () => {
    const api = useEnvelopePlanV2();

    const rule = { type: 'FIXED_PER_PERIOD' as const, priority: 10, fixedAmount: '65000' };
    await api.updateFundingRule(budgetId, 'env/1', rule, 'k-rule');
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes/env%2F1/funding-rule`);
    expect(call.init.method).toBe('PUT');
    expect(JSON.parse(call.init.body as string)).toEqual(rule);
    expect(call.headers.get('Idempotency-Key')).toBe('k-rule');
    expect(call.headers.get('x-csrf-token')).toBe('csrf-1');

    await api.updatePeriodTarget(budgetId, 'env-1', '2026-10-01', { target: '65000.50' }, 'k-t');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/envelopes/env-1/periods/2026-10-01/target`);
    expect(call.init.method).toBe('PUT');
    expect(JSON.parse(call.init.body as string)).toEqual({ target: '65000.50' });
    expect(call.headers.get('Idempotency-Key')).toBe('k-t');

    const suggestion = { enabled: true, sourceCategoryId: 'c-1', targetEnvelopeId: 'e-1' };
    await api.updateIncomeCategorySuggestion(budgetId, suggestion, 'k-s');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/income-category-suggestion`);
    expect(call.init.method).toBe('PUT');
    expect(JSON.parse(call.init.body as string)).toEqual(suggestion);
    expect(call.headers.get('Idempotency-Key')).toBe('k-s');
  });

  it('previews and confirms a cycle change and patches settings (T02/T02b contracts)', async () => {
    const api = useEnvelopePlanV2();
    await api.previewCycleChange(budgetId, { cycleStartDay: 12, periodBoundaryOffset: 14 });
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/cycle-change/preview`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body as string)).toEqual({
      cycleStartDay: 12,
      periodBoundaryOffset: 14,
    });
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call.headers.has('Idempotency-Key')).toBe(false);

    const confirm = {
      cycleStartDay: 12,
      periodBoundaryOffset: 14,
      previewHash: 'a'.repeat(64),
      transitionTargets: [{ periodStart: '2026-10-01', target: null }],
    };
    await api.confirmCycleChange(budgetId, confirm, 'k-c');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/cycle-change/confirm`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body as string)).toEqual(confirm);
    expect(call.headers.get('Idempotency-Key')).toBe('k-c');

    await api.updateBudgetSettings(budgetId, { timezone: 'Asia/Tokyo' }, 'k-s');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/settings`);
    expect(call.init.method).toBe('PATCH');
    expect(JSON.parse(call.init.body as string)).toEqual({ timezone: 'Asia/Tokyo' });
    expect(call.headers.get('Idempotency-Key')).toBe('k-s');
  });

  it('reads the v2 journal with only the API filters and no mutation headers', async () => {
    const api = useEnvelopePlanV2();
    await api.listTransactions(budgetId, {
      limit: 25,
      cursor: 'abc',
      type: 'EXPENSE',
      status: 'DELETED',
      from: '2026-09-01',
      to: '2026-09-30',
      accountId: 'a-1',
      categoryId: 'c-1',
      envelopeId: 'e-1',
    });

    let call = lastCall();
    const url = new URL(call.url);
    expect(url.pathname).toBe(`${base}/transactions`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '25',
      cursor: 'abc',
      type: 'EXPENSE',
      status: 'DELETED',
      from: '2026-09-01',
      to: '2026-09-30',
      accountId: 'a-1',
      categoryId: 'c-1',
      envelopeId: 'e-1',
    });
    expect(call.init.method ?? 'GET').toBe('GET');
    expect(call.headers.has('Idempotency-Key')).toBe(false);

    await api.listTransactions(budgetId);
    expect(lastCall().url).toBe(`${apiUrl}${base}/transactions`);

    await api.getTransaction(budgetId, 'tx/1');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/transactions/tx%2F1`);
  });

  it('edits, deletes and restores a transaction with CSRF and one Idempotency-Key each', async () => {
    const api = useEnvelopePlanV2();

    await api.updateTransaction(budgetId, 'tx-1', { amount: '10.50', comment: null }, 'k-u');
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/transactions/tx-1`);
    expect(call.init.method).toBe('PATCH');
    expect(JSON.parse(call.init.body as string)).toEqual({ amount: '10.50', comment: null });
    expect(call.headers.get('Idempotency-Key')).toBe('k-u');
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');

    await api.deleteTransaction(budgetId, 'tx-1', 'k-d');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/transactions/tx-1`);
    expect(call.init.method).toBe('DELETE');
    expect(call.init.body).toBeUndefined();
    expect(call.headers.get('Idempotency-Key')).toBe('k-d');

    await api.restoreTransaction(budgetId, 'tx-1', 'k-r');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/transactions/tx-1/restore`);
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toBe('k-r');
  });

  it('patches plans with the Idempotency-Key and only the given fields', async () => {
    const api = useEnvelopePlanV2();

    await api.updateObligationPlan(
      budgetId,
      'plan-1',
      { amount: '50000.00', applyToCurrentOpen: true },
      'key-obl',
    );
    let call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/obligations/plans/plan-1`);
    expect(call.init.method).toBe('PATCH');
    expect(call.headers.get('Idempotency-Key')).toBe('key-obl');
    expect(JSON.parse(String(call.init.body))).toEqual({
      amount: '50000.00',
      applyToCurrentOpen: true,
    });

    await api.updateIncomePlan(budgetId, 'plan-2', { status: 'ARCHIVED' }, 'key-inc');
    call = lastCall();
    expect(call.url).toBe(`${apiUrl}${base}/income-plans/plan-2`);
    expect(call.init.method).toBe('PATCH');
    expect(call.headers.get('Idempotency-Key')).toBe('key-inc');
    expect(JSON.parse(String(call.init.body))).toEqual({ status: 'ARCHIVED' });
  });
});
