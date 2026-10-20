import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  v1: {
    getBudget: vi.fn(),
    listEnvelopes: vi.fn(),
    getEnvelopesSummary: vi.fn(),
    getEnvelopeBalanceSummary: vi.fn(),
    createEnvelope: vi.fn(),
    updateEnvelope: vi.fn(),
    archiveEnvelope: vi.fn(),
  },
  v2: {
    listEnvelopes: vi.fn(),
    getEnvelopeHistory: vi.fn(),
    createEnvelope: vi.fn(),
    updateEnvelope: vi.fn(),
    archiveEnvelope: vi.fn(),
    move: vi.fn(),
    assignFree: vi.fn(),
  },
  route: { path: '/app/envelopes', query: {} as Record<string, string> },
  navigateTo: vi.fn(),
}));

vi.mock('#imports', () => ({
  definePageMeta: vi.fn(),
  navigateTo: mocks.navigateTo,
  useRoute: () => mocks.route,
}));
vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.v1,
}));
vi.mock('../../../composables/useEnvelopePlanV2.js', () => ({
  useEnvelopePlanV2: () => mocks.v2,
}));

import { selectOption } from '../../../test/select-option.js';
import EnvelopesPage from './index.vue';

function plan(overrides: Record<string, unknown>) {
  return {
    id: 'env-repair',
    name: 'Ремонт',
    envelopeType: 'CUSTOM',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '4000000',
    spentMinor: '1200000',
    balanceMinor: '2800000',
    archivedAt: null,
    ...overrides,
  };
}

const repair = plan({});
const savings = plan({
  id: 'env-save',
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  fundedMinor: '5000000',
  spentMinor: '0',
  balanceMinor: '5000000',
});
const food = plan({
  id: 'env-food',
  name: 'Продукты',
  envelopeType: 'CURRENT_EXPENSES',
  periodSlot: 'FIRST',
  fundedMinor: '1000000',
  spentMinor: '300000',
  balanceMinor: '700000',
});
const mandatory = plan({
  id: 'env-mand',
  name: 'Обязательные',
  envelopeType: 'MANDATORY_EXPENSES',
  fundedMinor: '0',
  spentMinor: '0',
  balanceMinor: '0',
});
const overspent = plan({
  id: 'env-over',
  name: 'Кафе',
  envelopeType: 'CURRENT_EXPENSES',
  fundedMinor: '100000',
  spentMinor: '200000',
  balanceMinor: '-100000',
});

const normalize = (value: string): string => value.replace(/\s/g, ' ');

function mountPage() {
  return mount(EnvelopesPage, {
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { template: '<a><slot /></a>' },
        UiConfirmDialog: {
          props: ['open'],
          template:
            '<div v-if="open" data-confirm-dialog><button data-confirm="archive-envelope" @click="$emit(\'confirm\')">Подтвердить</button><button @click="$emit(\'cancel\')">Отмена</button></div>',
        },
      },
    },
  });
}

async function openRowAction(wrapper: ReturnType<typeof mountPage>, id: string, action: string) {
  await wrapper.get(`[data-testid="row-actions-${id}"]`).trigger('click');
  await wrapper.get(`[data-testid="${action}"]`).trigger('click');
  await flushPromises();
}

function problem(status: number, code: string) {
  return new ApiRequestError(status, { code, detail: 'technical' } as never);
}

describe('envelopes page, plan model v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.query = {};
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [
            { id: 'budget-id', name: 'Бюджет', primaryCurrency: 'RUB', planModelVersion: 2 },
          ],
        },
      ],
    };
    mocks.v2.listEnvelopes.mockResolvedValue({ items: [repair, savings, food, mandatory] });
    mocks.v2.getEnvelopeHistory.mockResolvedValue({ items: [], nextCursor: null });
    mocks.v2.move.mockResolvedValue({
      movementId: 'm1',
      amountMinor: '2800000',
      sourceBalanceMinor: '0',
      destinationBalanceMinor: null,
      cashMinor: '9900000',
    });
    mocks.v2.archiveEnvelope.mockResolvedValue({ ...repair, archivedAt: '2026-10-01T00:00:00Z' });
    mocks.v2.createEnvelope.mockResolvedValue(repair);
  });

  it('shows assigned, spent and left from the server DTO without v1 calls', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const text = normalize(wrapper.text());
    expect(text).toContain('Отложено');
    expect(text).toContain('Потрачено');
    expect(text).toContain('Осталось');
    expect(text).toContain('28 000');
    expect(text).not.toContain('Начальный баланс конверта');
    expect(text).not.toContain('деньги на счёте');
    expect(mocks.v2.listEnvelopes).toHaveBeenCalledWith('budget-id');
    expect(mocks.v1.listEnvelopes).not.toHaveBeenCalled();
    expect(mocks.v1.getEnvelopesSummary).not.toHaveBeenCalled();
    expect(mocks.v1.getEnvelopeBalanceSummary).not.toHaveBeenCalled();
    expect(mocks.v1.getBudget).not.toHaveBeenCalled();
  });

  it('keeps the savings balance as the server reports it and labels it as carried over', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const row = wrapper.get('[data-testid="envelope-row-env-save"]');
    expect(normalize(row.text())).toContain('50 000');
    expect(row.text()).toContain('Остаток не сбрасывается при смене периода');
    expect(row.text()).toContain('не сбрасывается');
    expect(wrapper.get('[data-testid="envelope-row-env-mand"]').text()).toContain(
      'Обязательные платежи',
    );
  });

  it('asks where to send a positive balance before archiving, then moves and archives', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-repair', 'row-archive');
    expect(mocks.v2.archiveEnvelope).not.toHaveBeenCalled();
    expect(mocks.v2.move).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="move-panel"]')).not.toBeNull();

    (
      document.querySelector('[data-testid="move-direction-envelope-free"]') as HTMLInputElement
    ).click();
    await flushPromises();
    (document.querySelector('[data-testid="move-confirm"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(mocks.v2.move).toHaveBeenCalledTimes(1);
    expect(mocks.v2.move).toHaveBeenCalledWith(
      'budget-id',
      { sourceEnvelopeId: 'env-repair', destinationEnvelopeId: null, amount: '28000.00' },
      expect.any(String),
    );
    expect(mocks.v2.archiveEnvelope).toHaveBeenCalledTimes(1);
    expect(mocks.v2.archiveEnvelope).toHaveBeenCalledWith(
      'budget-id',
      'env-repair',
      expect.any(String),
    );
    expect(mocks.v2.move.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.v2.archiveEnvelope.mock.invocationCallOrder[0]!,
    );
  });

  it('does not archive an overspent envelope and asks to cover it first', async () => {
    mocks.v2.listEnvelopes.mockResolvedValue({ items: [overspent, savings] });
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-over', 'row-archive');

    expect(wrapper.get('[data-testid="archive-blocked"]').text()).toContain('Сначала покройте');
    expect(mocks.v2.archiveEnvelope).not.toHaveBeenCalled();
    expect(mocks.v2.move).not.toHaveBeenCalled();
  });

  it('archives an empty envelope only after confirmation', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    expect(mocks.v2.archiveEnvelope).not.toHaveBeenCalled();
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();

    expect(mocks.v2.archiveEnvelope).toHaveBeenCalledWith(
      'budget-id',
      'env-mand',
      expect.any(String),
    );
  });

  it('shows a Russian message for ENVELOPE_HAS_BALANCE from archive', async () => {
    mocks.v2.archiveEnvelope.mockRejectedValue(problem(409, 'ENVELOPE_HAS_BALANCE'));
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('В конверте остались деньги');
    expect(wrapper.text()).not.toContain('technical');
  });

  it('reassigns between envelopes with one key and ignores a double submit', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.v2.move.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-repair', 'row-reassign');
    expect(normalize(document.body.textContent ?? '')).toContain('28 000');

    const destination = document.querySelector(
      '[data-testid="move-destination"]',
    ) as HTMLSelectElement;
    destination.value = 'env-save';
    destination.dispatchEvent(new Event('change', { bubbles: true }));
    const amount = document.querySelector('[data-testid="move-amount"]') as HTMLInputElement;
    amount.value = '100,50';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const confirm = document.querySelector('[data-testid="move-confirm"]') as HTMLButtonElement;
    confirm.click();
    confirm.click();
    await flushPromises();

    expect(mocks.v2.move).toHaveBeenCalledTimes(1);
    expect(mocks.v2.move).toHaveBeenCalledWith(
      'budget-id',
      {
        sourceEnvelopeId: 'env-repair',
        destinationEnvelopeId: 'env-save',
        amount: '100.50',
      },
      expect.any(String),
    );
    release({
      movementId: 'm2',
      amountMinor: '10050',
      sourceBalanceMinor: '2789950',
      destinationBalanceMinor: '5010050',
      cashMinor: '1',
    });
    await flushPromises();
    expect(normalize(wrapper.text())).toContain('27 899,50');
  });

  it('assigns free money to an envelope through assignFree', async () => {
    mocks.v2.assignFree.mockResolvedValue({
      assignmentId: 'a1',
      amountMinor: '50000',
      fundedMinor: '4050000',
      spentMinor: '1200000',
      balanceMinor: '2850000',
      freeToAssignMinor: '0',
    });
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-repair', 'row-reassign');
    (
      document.querySelector('[data-testid="move-direction-free-envelope"]') as HTMLInputElement
    ).click();
    await flushPromises();
    const amount = document.querySelector('[data-testid="move-amount"]') as HTMLInputElement;
    amount.value = '500';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    (document.querySelector('[data-testid="move-confirm"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(mocks.v2.assignFree).toHaveBeenCalledWith(
      'budget-id',
      { envelopeId: 'env-repair', amount: '500' },
      expect.any(String),
    );
    expect(mocks.v2.move).not.toHaveBeenCalled();
  });

  it('shows the dialog history with dates and loads more by cursor', async () => {
    mocks.v2.getEnvelopeHistory
      .mockResolvedValueOnce({
        items: [{ kind: 'SPENDING', amountMinor: '120000', effectiveOn: '2026-09-30' }],
        nextCursor: 'cur-1',
      })
      .mockResolvedValueOnce({
        items: [{ kind: 'ASSIGNMENT', amountMinor: '4000000', effectiveOn: '2026-09-01' }],
        nextCursor: null,
      });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper
      .get('[data-testid="envelope-row-env-repair"] [data-testid="list-row-select"]')
      .trigger('click');
    await flushPromises();

    expect(mocks.v2.getEnvelopeHistory).toHaveBeenCalledWith('budget-id', 'env-repair', {});
    const dialog = wrapper.get('[data-testid="modal"]');
    expect(dialog.text()).toContain('30.09.2026');
    expect(dialog.text()).toContain('Расход');
    expect(dialog.text()).not.toContain('Начальный баланс');

    await wrapper.get('[data-testid="history-more"]').trigger('click');
    await flushPromises();
    expect(mocks.v2.getEnvelopeHistory).toHaveBeenLastCalledWith('budget-id', 'env-repair', {
      cursor: 'cur-1',
    });
    expect(wrapper.get('[data-testid="modal"]').text()).toContain('01.09.2026');
    expect(wrapper.find('[data-testid="history-more"]').exists()).toBe(false);
  });

  it('creates an envelope by scope without a physical starting balance', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await flushPromises();

    expect(document.querySelector('input[name="startingBalance"]')).toBeNull();
    const name = document.querySelector('input[name="name"]') as HTMLInputElement;
    name.value = 'Кафе';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await selectOption(document, 'envelopeType', 'CURRENT_EXPENSES');
    await flushPromises();
    await selectOption(document, 'periodSlot', 'SECOND');
    await flushPromises();
    document
      .querySelector('form[data-envelope-form]')!
      .dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.v2.createEnvelope).toHaveBeenCalledWith(
      'budget-id',
      { name: 'Кафе', envelopeType: 'CURRENT_EXPENSES', periodSlot: 'SECOND' },
      expect.any(String),
    );
  });

  it('explains MANDATORY_ENVELOPE_EXISTS in Russian', async () => {
    mocks.v2.createEnvelope.mockRejectedValue(problem(409, 'MANDATORY_ENVELOPE_EXISTS'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await flushPromises();
    const name = document.querySelector('input[name="name"]') as HTMLInputElement;
    name.value = 'Ещё обязательные';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await selectOption(document, 'envelopeType', 'MANDATORY_EXPENSES');
    await flushPromises();
    document
      .querySelector('form[data-envelope-form]')!
      .dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(normalize(document.body.textContent ?? '')).toContain(
      'может быть только один активный конверт обязательных платежей',
    );
  });

  it('shows an explanation for action-path queries and ignores unknown ones', async () => {
    mocks.route.query = { leftoverPeriod: 'period-old' };
    const first = mountPage();
    await flushPromises();
    expect(first.get('[data-testid="envelopes-action-note"]').text()).toContain('Переложить');
    expect(mocks.v2.move).not.toHaveBeenCalled();
    first.unmount();

    mocks.route.query = { cover: 'mandatory' };
    const second = mountPage();
    await flushPromises();
    expect(second.get('[data-testid="envelope-row-env-mand"]').attributes('data-highlighted')).toBe(
      'true',
    );
    second.unmount();

    mocks.route.query = { somethingNew: 'x' };
    const third = mountPage();
    await flushPromises();
    expect(third.find('[data-testid="envelopes-action-note"]').exists()).toBe(false);
    expect(third.text()).toContain('Ремонт');
  });
  // Review fixes

  const keyOf = (mock: { mock: { calls: unknown[][] } }, call: number): unknown =>
    mock.mock.calls[call]?.[2];

  async function setValue(selector: string, value: string, event = 'input') {
    const element = document.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    element.value = value;
    element.dispatchEvent(new Event(event, { bubbles: true }));
    await flushPromises();
  }

  async function clickConfirm() {
    (document.querySelector('[data-testid="move-confirm"]') as HTMLButtonElement).click();
    await flushPromises();
  }

  async function openMove(wrapper: ReturnType<typeof mountPage>, id = 'env-repair') {
    await openRowAction(wrapper, id, 'row-reassign');
    await setValue('[data-testid="move-destination"]', 'env-save', 'change');
  }

  async function submitForm() {
    document
      .querySelector('form[data-envelope-form]')!
      .dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();
  }

  async function openCreate(name: string) {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-action="create-envelope"]').trigger('click');
    await flushPromises();
    await setValue('input[name="name"]', name);
    return wrapper;
  }

  it('reuses the Idempotency-Key when the same move is retried', async () => {
    mocks.v2.move.mockRejectedValueOnce(problem(500, 'BROKEN')).mockResolvedValue({
      movementId: 'm',
      amountMinor: '1',
      sourceBalanceMinor: '0',
      destinationBalanceMinor: '0',
      cashMinor: '0',
    });
    const wrapper = mountPage();
    await flushPromises();
    await openMove(wrapper);
    await setValue('[data-testid="move-amount"]', '10');
    await clickConfirm();
    expect(document.querySelector('[data-testid="move-error"]')).not.toBeNull();
    await clickConfirm();

    expect(mocks.v2.move).toHaveBeenCalledTimes(2);
    expect(keyOf(mocks.v2.move, 1)).toBe(keyOf(mocks.v2.move, 0));
  });

  it('uses a new Idempotency-Key when the amount changes after a failed move', async () => {
    mocks.v2.move.mockRejectedValue(problem(500, 'BROKEN'));
    const wrapper = mountPage();
    await flushPromises();
    await openMove(wrapper);
    await setValue('[data-testid="move-amount"]', '10');
    await clickConfirm();
    await setValue('[data-testid="move-amount"]', '11');
    await clickConfirm();

    expect(keyOf(mocks.v2.move, 1)).not.toBe(keyOf(mocks.v2.move, 0));
  });

  it('rejects an empty or zero move amount without calling the API', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await openMove(wrapper);

    await clickConfirm();
    expect(document.querySelector('[data-testid="move-amount-error"]')).not.toBeNull();
    await setValue('[data-testid="move-amount"]', '0');
    await clickConfirm();
    expect(document.querySelector('[data-testid="move-amount-error"]')!.textContent).toContain(
      'больше нуля',
    );
    expect(mocks.v2.move).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'INSUFFICIENT_ENVELOPE_BALANCE', 'Нельзя перенести больше доступного остатка'],
    [422, 'VALIDATION_FAILED', 'Проверьте введённые данные'],
  ])('shows a Russian panel error for move %s %s', async (status, code, text) => {
    mocks.v2.move.mockRejectedValue(problem(status, code));
    const wrapper = mountPage();
    await flushPromises();
    await openMove(wrapper);
    await setValue('[data-testid="move-amount"]', '10');
    await clickConfirm();

    const message = document.querySelector('[data-testid="move-error"]')!.textContent!;
    expect(message).toContain(text);
    expect(message).not.toContain('technical');
  });

  describe('period envelopes (balances live in period buckets)', () => {
    const OLD = {
      periodId: 'p-old',
      startsOn: '2026-09-10',
      endsOn: '2026-09-24',
      fundedMinor: '100000',
      spentMinor: '0',
      balanceMinor: '100000',
      current: false,
    };
    const CURRENT = {
      periodId: 'p-cur',
      startsOn: '2026-09-25',
      endsOn: '2026-10-09',
      fundedMinor: '600000',
      spentMinor: '0',
      balanceMinor: '600000',
      current: true,
    };
    const periodFood = (periods: unknown[]) => ({ ...food, balanceMinor: '700000', periods });

    async function mountWith(items: unknown[]) {
      mocks.v2.listEnvelopes.mockResolvedValue({ items });
      const wrapper = mountPage();
      await flushPromises();
      return wrapper;
    }

    async function chooseDirection(direction: string) {
      (
        document.querySelector(`[data-testid="move-direction-${direction}"]`) as HTMLInputElement
      ).click();
      await flushPromises();
    }

    it('returns money to free from the current period and sends its id', async () => {
      const wrapper = await mountWith([repair, savings, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      await setValue('[data-testid="move-source-period"]', 'p-cur', 'change');
      await setValue('[data-testid="move-amount"]', '1000');
      await clickConfirm();

      expect(mocks.v2.move).toHaveBeenCalledWith(
        'budget-id',
        {
          sourceEnvelopeId: 'env-food',
          sourcePeriodId: 'p-cur',
          destinationEnvelopeId: null,
          amount: '1000',
        },
        expect.any(String),
      );
    });

    it('offers the period choice with the current one preselected and server balances', async () => {
      const wrapper = await mountWith([repair, savings, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');

      const select = document.querySelector(
        '[data-testid="move-source-period"]',
      ) as HTMLSelectElement;
      expect(select.value).toBe('p-cur');
      const label = normalize(select.textContent ?? '');
      expect(label).toContain('идёт сейчас');
      expect(label).toContain('6 000,00');
      expect(label).toContain('1 000,00');
    });

    it('moves from an older period when the user picks it', async () => {
      const wrapper = await mountWith([repair, savings, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      await setValue('[data-testid="move-source-period"]', 'p-old', 'change');
      await setValue('[data-testid="move-amount"]', '500');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toMatchObject({ sourcePeriodId: 'p-old' });
    });

    it('does not show a period choice when only one period holds money', async () => {
      const wrapper = await mountWith([
        repair,
        savings,
        periodFood([{ ...OLD, balanceMinor: '0', fundedMinor: '0' }, CURRENT]),
      ]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      expect(document.querySelector('[data-testid="move-source-period"]')).toBeNull();
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toMatchObject({ sourcePeriodId: 'p-cur' });
    });

    it('says so and sends nothing when no period of the envelope holds money', async () => {
      const wrapper = await mountWith([
        repair,
        savings,
        periodFood([{ ...CURRENT, balanceMinor: '0', fundedMinor: '0' }]),
      ]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      // No amount typed: the "no money" message comes first, not "Введите сумму".
      await clickConfirm();

      expect(mocks.v2.move).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="move-amount-error"]')).toBeNull();
      expect(document.querySelector('[data-testid="move-error"]')!.textContent).toContain(
        'нет денег',
      );
    });

    it('sends the destination current period when moving into a period envelope', async () => {
      const wrapper = await mountWith([repair, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-repair', 'row-reassign');
      await setValue('[data-testid="move-destination"]', 'env-food', 'change');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toEqual({
        sourceEnvelopeId: 'env-repair',
        destinationEnvelopeId: 'env-food',
        destinationPeriodId: 'p-cur',
        amount: '10',
      });
    });

    it('does not move into a period envelope that has no current period', async () => {
      const wrapper = await mountWith([repair, periodFood([OLD])]);
      await openRowAction(wrapper, 'env-repair', 'row-reassign');
      await setValue('[data-testid="move-destination"]', 'env-food', 'change');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      expect(mocks.v2.move).not.toHaveBeenCalled();
      const error = document.querySelector('[data-testid="move-destination-error"]');
      expect(error!.textContent).toContain('нет текущего периода');

      // Picking another envelope clears the stale error.
      await setValue('[data-testid="move-destination"]', 'env-repair', 'change');
      expect(document.querySelector('[data-testid="move-destination-error"]')).toBeNull();
    });

    it('assigns free money to the current period of a period envelope', async () => {
      mocks.v2.assignFree.mockResolvedValue({
        assignmentId: 'a2',
        amountMinor: '1000',
        fundedMinor: '1',
        spentMinor: '0',
        balanceMinor: '1',
        freeToAssignMinor: '0',
      });
      const wrapper = await mountWith([repair, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('free-envelope');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      expect(mocks.v2.assignFree).toHaveBeenCalledWith(
        'budget-id',
        { envelopeId: 'env-food', periodId: 'p-cur', amount: '10' },
        expect.any(String),
      );
    });

    it('archive: locks the amount to the chosen period bucket and follows a bucket switch', async () => {
      const wrapper = await mountWith([repair, savings, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-archive');
      const amount = () =>
        (document.querySelector('[data-testid="move-amount"]') as HTMLInputElement).value;

      expect(amount()).toBe('6000.00');
      await setValue('[data-testid="move-source-period"]', 'p-old', 'change');
      expect(amount()).toBe('1000.00');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toMatchObject({
        sourceEnvelopeId: 'env-food',
        sourcePeriodId: 'p-old',
        amount: '1000.00',
      });
    });

    it('archive with one money bucket sends that bucket and its whole balance', async () => {
      const wrapper = await mountWith([repair, savings, periodFood([CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-archive');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toEqual({
        sourceEnvelopeId: 'env-food',
        sourcePeriodId: 'p-cur',
        destinationEnvelopeId: null,
        amount: '6000.00',
      });
    });

    it('uses a new Idempotency-Key after the user switches the source period', async () => {
      mocks.v2.move.mockRejectedValue(problem(500, 'BROKEN'));
      const wrapper = await mountWith([repair, savings, periodFood([OLD, CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();
      await setValue('[data-testid="move-source-period"]', 'p-old', 'change');
      await clickConfirm();

      expect(keyOf(mocks.v2.move, 1)).not.toBe(keyOf(mocks.v2.move, 0));
    });

    it('does not carry the period of one envelope over to another', async () => {
      const other = plan({
        id: 'env-second',
        name: 'Второй период',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: 'SECOND',
        balanceMinor: '300000',
        periods: [
          {
            periodId: 'p2-cur',
            startsOn: '2026-09-25',
            endsOn: '2026-10-09',
            fundedMinor: '300000',
            spentMinor: '0',
            balanceMinor: '300000',
            current: true,
          },
        ],
      });
      const wrapper = await mountWith([repair, periodFood([OLD, CURRENT]), other]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      (document.querySelector('[data-testid="move-cancel"]') as HTMLButtonElement).click();
      await flushPromises();

      await openRowAction(wrapper, 'env-second', 'row-reassign');
      await chooseDirection('envelope-free');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      expect(mocks.v2.move.mock.calls[0]![1]).toMatchObject({
        sourceEnvelopeId: 'env-second',
        sourcePeriodId: 'p2-cur',
      });
    });

    it('no longer points to a main-screen card that does not exist for the current period', async () => {
      mocks.v2.move.mockRejectedValue(problem(409, 'INSUFFICIENT_ENVELOPE_BALANCE'));
      const wrapper = await mountWith([repair, savings, periodFood([CURRENT])]);
      await openRowAction(wrapper, 'env-food', 'row-reassign');
      await chooseDirection('envelope-free');
      await setValue('[data-testid="move-amount"]', '10');
      await clickConfirm();

      const message = document.querySelector('[data-testid="move-error"]')!.textContent!;
      expect(message).not.toContain('карточку остатка периода');
      expect(message).toContain('Нельзя перенести больше доступного остатка');
    });
  });

  it('does not archive when the remainder move fails', async () => {
    mocks.v2.move.mockRejectedValue(problem(409, 'INSUFFICIENT_ENVELOPE_BALANCE'));
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-repair', 'row-archive');
    await clickConfirm();

    expect(mocks.v2.move).toHaveBeenCalledTimes(1);
    expect(mocks.v2.archiveEnvelope).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="move-error"]')).not.toBeNull();
  });

  it('retries archive of an empty envelope with the same key after ENVELOPE_HAS_BALANCE', async () => {
    mocks.v2.archiveEnvelope
      .mockRejectedValueOnce(problem(409, 'ENVELOPE_HAS_BALANCE'))
      .mockResolvedValue({ ...mandatory, archivedAt: '2026-10-01T00:00:00Z' });
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('В конверте остались деньги');

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();

    expect(mocks.v2.archiveEnvelope).toHaveBeenCalledTimes(2);
    expect(keyOf(mocks.v2.archiveEnvelope, 1)).toBe(keyOf(mocks.v2.archiveEnvelope, 0));
    expect(wrapper.text()).toContain('перемещён в архив');
  });

  it('ignores a double archive confirmation', async () => {
    mocks.v2.archiveEnvelope.mockReturnValue(new Promise(() => undefined));
    const wrapper = mountPage();
    await flushPromises();

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    const confirm = wrapper.get('[data-confirm="archive-envelope"]');
    await confirm.trigger('click');
    await confirm.trigger('click');

    expect(mocks.v2.archiveEnvelope).toHaveBeenCalledTimes(1);
  });

  it('keeps the create key on retry and changes it with the payload', async () => {
    mocks.v2.createEnvelope.mockRejectedValue(problem(500, 'BROKEN'));
    await openCreate('Кафе');
    await submitForm();
    await submitForm();
    expect(keyOf(mocks.v2.createEnvelope, 1)).toBe(keyOf(mocks.v2.createEnvelope, 0));

    await setValue('input[name="name"]', 'Кафе 2');
    await submitForm();
    expect(keyOf(mocks.v2.createEnvelope, 2)).not.toBe(keyOf(mocks.v2.createEnvelope, 0));
  });

  it('ignores a double create submit while the request is pending', async () => {
    mocks.v2.createEnvelope.mockReturnValue(new Promise(() => undefined));
    await openCreate('Кафе');
    const form = document.querySelector('form[data-envelope-form]')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.v2.createEnvelope).toHaveBeenCalledTimes(1);
  });

  it('renames an envelope with a name-only payload, a stable retry key and no double submit', async () => {
    mocks.v2.updateEnvelope
      .mockRejectedValueOnce(problem(500, 'BROKEN'))
      .mockReturnValueOnce(new Promise(() => undefined));
    const wrapper = mountPage();
    await flushPromises();
    await openRowAction(wrapper, 'env-repair', 'row-edit');
    await setValue('input[name="name"]', 'Ремонт кухни');

    await submitForm();
    const form = document.querySelector('form[data-envelope-form]')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    await flushPromises();

    expect(mocks.v2.updateEnvelope).toHaveBeenCalledTimes(2);
    expect(mocks.v2.updateEnvelope).toHaveBeenCalledWith(
      'budget-id',
      'env-repair',
      { name: 'Ремонт кухни' },
      expect.any(String),
    );
    expect(mocks.v2.updateEnvelope.mock.calls[1]![3]).toBe(
      mocks.v2.updateEnvelope.mock.calls[0]![3],
    );
  });

  it('names each row menu after its envelope', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const labels = ['env-repair', 'env-save'].map((id) =>
      wrapper.get(`[data-testid="row-actions-${id}"]`).attributes('aria-label'),
    );
    expect(labels).toEqual(['Действия: Ремонт', 'Действия: Отпуск']);
  });

  it('keeps a persistent polite live region for results', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const region = wrapper.get('[data-testid="envelopes-status-region"]');
    expect(region.attributes('role')).toBe('status');
    expect(region.attributes('aria-live')).toBe('polite');
    expect(region.text()).toBe('');

    await openRowAction(wrapper, 'env-mand', 'row-archive');
    await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="envelopes-status-region"]').text()).toContain('в архив');
  });

  it('marks a highlighted row with text, not only a style', async () => {
    mocks.route.query = { cover: 'mandatory' };
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="envelope-row-env-mand"]').text()).toContain(
      'Нужно пополнить',
    );
    expect(wrapper.get('[data-testid="envelope-row-env-repair"]').text()).not.toContain(
      'Нужно пополнить',
    );
  });

  it('shows the envelope goal in rubles from the decimal server value', async () => {
    mocks.v2.listEnvelopes.mockResolvedValue({
      items: [{ ...savings, targetAmountMinor: '5000' }],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(normalize(wrapper.get('[data-testid="plan-row-target"]').text())).toContain('5 000,00');
    await wrapper.get('[data-testid="list-row-select"]').trigger('click');
    await flushPromises();
    expect(normalize(wrapper.get('[data-testid="modal"]').text())).toContain('5 000,00');
    expect(wrapper.get('[data-testid="modal"]').text()).not.toContain('50,00');
  });
});
