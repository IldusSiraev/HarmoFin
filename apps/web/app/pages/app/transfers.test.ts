import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: {
      value: {
        workspaces: [{ budgets: [{ id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB' }] }],
      } as {
        workspaces: Array<{
          budgets: Array<{ id: string; name: string; primaryCurrency: string }>;
        }>;
      } | null,
    },
    loadMe: vi.fn(),
  },
  v2: { listEnvelopes: vi.fn(), createTransfer: vi.fn(), listDirectTransfers: vi.fn() },
  api: {
    listAccounts: vi.fn(),
    listCategories: vi.fn(),
    listEnvelopes: vi.fn(),
    listTransfers: vi.fn(),
    createTransfer: vi.fn(),
    confirmTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
  },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  useRoute: () => ({ query: { sourceAccountId: 'source-account' } }),
}));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => mocks.api,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import TransfersPage from './transfers.vue';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';

describe('transfers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page reads the shared reference cache, which outlives a single test.
    useOperationReferenceData().invalidate();
    mocks.api.listCategories.mockResolvedValue([]);
    mocks.api.listAccounts.mockResolvedValue([
      { id: 'source-account', name: 'Основной счёт', archivedAt: null },
      { id: 'destination-account', name: 'Накопительный счёт', archivedAt: null },
    ]);
    mocks.api.listEnvelopes.mockResolvedValue([{ id: 'repair', name: 'Ремонт', archivedAt: null }]);
    mocks.api.listTransfers.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('loads server references before applying source-account prefill', async () => {
    const wrapper = mount(TransfersPage, {
      attachTo: document.body,
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' }, UiConfirmDialog: true } },
    });
    await flushPromises();

    await wrapper.get('[data-action="create-transfer"]').trigger('click');
    const selectElement = document.querySelector(
      'select[name="sourceAccountId"]',
    ) as HTMLSelectElement;
    expect(selectElement.value).toBe('source-account');
  });

  function mountPage() {
    document.body.innerHTML = '';
    return mount(TransfersPage, {
      attachTo: document.body,
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' }, UiConfirmDialog: true } },
    });
  }

  function setField(selector: string, value: string, eventName = 'input') {
    const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    element.value = value;
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function submitDirect() {
    document
      .querySelector<HTMLFormElement>('[data-testid="direct-transfer-form"]')!
      .requestSubmit();
  }

  it('creates a v1 transfer through the v1 API', async () => {
    mocks.api.createTransfer.mockResolvedValue({ id: 'new' });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-action="create-transfer"]').trigger('click');
    document
      .querySelector('form.transfer-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(mocks.v2.createTransfer).not.toHaveBeenCalled();
    expect(mocks.api.createTransfer).toHaveBeenCalledTimes(1);
    expect(mocks.api.createTransfer.mock.calls[0]![1]).toHaveProperty('parts');
    expect(mocks.v2.listDirectTransfers).not.toHaveBeenCalled();
  });

  describe('v2 budget', () => {
    const budget = () =>
      mocks.auth.currentData.value!.workspaces[0]!.budgets[0] as Record<string, unknown>;

    beforeEach(() => {
      budget().planModelVersion = 2;
      mocks.v2.listEnvelopes.mockResolvedValue({ items: [] });
      mocks.v2.listDirectTransfers.mockResolvedValue({
        items: [
          {
            id: 'old',
            status: 'CONFIRMED',
            mode: 'LEGACY_PARTS',
            totalMinor: '10000',
            occurredOn: '2026-01-01',
            comment: null,
            sourceAccountId: 'source-account',
            destinationAccountId: 'destination-account',
            parts: [],
          },
        ],
        nextCursor: null,
      });
    });

    afterEach(() => {
      delete budget().planModelVersion;
    });

    async function openForm() {
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('[data-action="create-transfer"]').trigger('click');
      setField('input[name="total"]', '700');
      setField('select[name="destinationAccountId"]', 'destination-account', 'change');
      await flushPromises();
      return wrapper;
    }

    it('reads the list through the v2 endpoint without a status filter and without edit actions', async () => {
      const wrapper = mountPage();
      await flushPromises();

      expect(mocks.api.listTransfers).not.toHaveBeenCalled();
      expect(mocks.v2.listDirectTransfers).toHaveBeenCalledWith('budget-id', {});
      expect(wrapper.find('select[name="status"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Основной счёт');
      expect(wrapper.text()).toContain('Накопительный счёт');
      expect(wrapper.text()).not.toContain('Подтвердить');
      expect(wrapper.text()).not.toContain('Удалить');
    });

    it('offers an account-to-account form and sends only the four fields', async () => {
      mocks.v2.createTransfer.mockResolvedValue({ id: 'new-transfer' });
      await openForm();
      expect(document.querySelector('[name^="sourceEnvelope"]')).toBeNull();
      expect(document.querySelector('[data-testid="add-transfer-part"]')).toBeNull();
      submitDirect();
      await flushPromises();

      expect(mocks.api.createTransfer).not.toHaveBeenCalled();
      const [id, body] = mocks.v2.createTransfer.mock.calls[0]!;
      expect(id).toBe('budget-id');
      expect(body).not.toHaveProperty('parts');
      expect(body).toEqual({
        sourceAccountId: 'source-account',
        destinationAccountId: 'destination-account',
        amount: '700',
        occurredOn: expect.any(String),
      });
    });

    it('keeps the key on retry and changes it when a field changes', async () => {
      mocks.v2.createTransfer.mockRejectedValue(new Error('x'));
      await openForm();
      submitDirect();
      await flushPromises();
      submitDirect();
      await flushPromises();
      expect(mocks.v2.createTransfer.mock.calls[1]![2]).toBe(
        mocks.v2.createTransfer.mock.calls[0]![2],
      );

      setField('input[name="total"]', '800');
      await flushPromises();
      submitDirect();
      await flushPromises();
      expect(mocks.v2.createTransfer.mock.calls[2]![2]).not.toBe(
        mocks.v2.createTransfer.mock.calls[0]![2],
      );
    });

    it('sends one request when submitted twice while in flight', async () => {
      let finish!: (value: { id: string }) => void;
      mocks.v2.createTransfer.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await openForm();
      submitDirect();
      submitDirect();
      await flushPromises();
      expect(mocks.v2.createTransfer).toHaveBeenCalledTimes(1);
      finish({ id: 'x' });
      await flushPromises();
    });

    it.each([
      [409, 'INSUFFICIENT_BALANCE', 'Недостаточно средств'],
      [409, 'IDEMPOTENCY_CONFLICT', 'другими данными'],
      [409, 'MODEL_VERSION_MISMATCH', 'Обновите страницу'],
      [422, 'VALIDATION_FAILED', 'Проверьте введённые данные'],
    ])('shows a Russian alert for %s %s and keeps the form open', async (status, code, text) => {
      mocks.v2.createTransfer.mockRejectedValue(
        new ApiRequestError(status, { code, detail: 'raw english detail' }),
      );
      await openForm();
      submitDirect();
      await flushPromises();

      const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
      expect(alerts.join(' ')).toContain(text);
      expect(alerts.join(' ')).not.toContain('raw english');
      expect(document.querySelector('[data-testid="direct-transfer-form"]')).not.toBeNull();
    });
  });
});
