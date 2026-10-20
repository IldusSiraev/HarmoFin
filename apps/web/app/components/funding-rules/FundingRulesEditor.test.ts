import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

enableAutoUnmount(afterEach);

const BUDGET = 'budget-1';

const mocks = vi.hoisted(() => ({
  v2: { listEnvelopes: vi.fn(), listFundingRules: vi.fn(), saveFundingRules: vi.fn() },
  reference: { getBudget: vi.fn(), listCategories: vi.fn() },
  push: vi.fn(),
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.reference,
}));
vi.mock('../../composables/useToast.js', () => ({ useToast: () => ({ push: mocks.push }) }));

import FundingRulesEditor from './FundingRulesEditor.vue';

const envelope = (id: string, name: string, envelopeType = 'CURRENT_EXPENSES') => ({
  id,
  name,
  envelopeType,
  periodSlot: null,
  targetAmountMinor: null,
  comment: null,
  fundedMinor: '0',
  spentMinor: '0',
  balanceMinor: '0',
  archivedAt: null,
});
const rule = (envelopeId: string, type: string, priority: number, extra = {}) => ({
  id: `r-${envelopeId}`,
  envelopeId,
  type,
  priority,
  fixedAmountMinor: null,
  percentBasisPoints: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.listEnvelopes.mockResolvedValue({
    items: [
      envelope('a', 'Еда'),
      envelope('b', 'Подушка', 'SAVINGS_GOAL'),
      envelope('c', 'Аптека'),
    ],
  });
  mocks.v2.listFundingRules.mockResolvedValue({
    items: [
      rule('a', 'FIXED_PER_PERIOD', 10, { fixedAmountMinor: '1500000' }),
      rule('b', 'PERCENT_OF_INCOME', 20, { percentBasisPoints: 1000 }),
    ],
  });
  mocks.reference.getBudget.mockResolvedValue({
    incomeAllocationRuleEnabled: true,
    incomeAllocationSourceCategoryId: 'cat',
    incomeAllocationTargetEnvelopeId: 'b',
  });
  mocks.reference.listCategories.mockResolvedValue([{ id: 'cat', name: 'Зарплата' }]);
});

async function mountEditor() {
  const wrapper = mount(FundingRulesEditor, {
    props: { budgetId: BUDGET },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}
const queueIds = (wrapper: Awaited<ReturnType<typeof mountEditor>>) =>
  wrapper
    .findAll('[data-testid="rules-queue"] [data-queue-item]')
    .map((item) => item.attributes('data-envelope-id'));

describe('FundingRulesEditor', () => {
  it('показывает очередь по порядку, вне очереди и метку дохода', async () => {
    const wrapper = await mountEditor();
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Аптека');
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Правило не задано');
    expect(wrapper.find('[data-testid="rule-income-b"]').text()).toContain('Доход: Зарплата');
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeDefined();
  });

  it('смена типа переносит карточку между зонами и включает сохранение', async () => {
    const wrapper = await mountEditor();
    const emitted = () => wrapper.emitted('dirty') ?? [];
    await wrapper.find('[data-testid="rule-type-a"]').setValue('MANUAL');
    expect(queueIds(wrapper)).toEqual(['b']);
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Еда');
    expect(emitted().at(-1)).toEqual([true]);
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeUndefined();
    await wrapper.find('[data-testid="rules-reset"]').trigger('click');
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
    expect(emitted().at(-1)).toEqual([false]);
  });

  it('кнопки ↑/↓ переставляют и объявляют позицию', async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-down-a"]').trigger('click');
    expect(queueIds(wrapper)).toEqual(['b', 'a']);
    expect(wrapper.find('[data-testid="rules-announce"]').text()).toBe('Еда: позиция 2 из 2');
    expect(wrapper.find('[data-testid="rule-down-a"]').attributes('disabled')).toBeDefined();
  });

  it('сохраняет одним запросом и перечитывает ответ', async () => {
    mocks.v2.saveFundingRules.mockResolvedValue({
      items: [
        rule('b', 'PERCENT_OF_INCOME', 10, { percentBasisPoints: 1000 }),
        rule('a', 'FIXED_PER_PERIOD', 20, { fixedAmountMinor: '1500000' }),
      ],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-up-b"]').trigger('click');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    await flushPromises();
    const [budgetId, body, key] = mocks.v2.saveFundingRules.mock.calls[0]!;
    expect(budgetId).toBe(BUDGET);
    expect(body).toEqual({
      queue: [
        { envelopeId: 'b', type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        { envelopeId: 'a', type: 'FIXED_PER_PERIOD', fixedAmount: '15000.00' },
      ],
      outside: [],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
    expect(typeof key).toBe('string');
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeDefined();
  });

  it('пока идёт сохранение, правки заблокированы', async () => {
    let resolveSave: (value: unknown) => void = () => {};
    mocks.v2.saveFundingRules.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-up-b"]').trigger('click');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    await flushPromises();
    expect(mocks.v2.saveFundingRules).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-testid="rule-down-b"]').trigger('click');
    expect(queueIds(wrapper)).toEqual(['b', 'a']);
    expect(wrapper.find('[data-testid="rule-down-b"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="rule-type-a"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="rule-fixed-a"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="rule-type-c"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="suggestion-enabled"]').attributes('disabled')).toBeDefined();
    expect(
      wrapper.find('[data-testid="suggestion-category"]').attributes('disabled'),
    ).toBeDefined();

    resolveSave({
      items: [
        rule('b', 'PERCENT_OF_INCOME', 10, { percentBasisPoints: 1000 }),
        rule('a', 'FIXED_PER_PERIOD', 20, { fixedAmountMinor: '1500000' }),
      ],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="rule-type-a"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="rule-down-b"]').attributes('disabled')).toBeUndefined();
  });

  it('ошибка формы показывается у поля, запрос не уходит', async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-fixed-a"]').setValue('0');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    expect(mocks.v2.saveFundingRules).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="rule-card-a"]').text()).toContain(
      'Укажите сумму больше нуля',
    );
    expect(wrapper.find('[data-testid="rule-fixed-a"]').attributes('aria-invalid')).toBe('true');
  });

  it('ошибка сервера с путём показывается в нужной карточке', async () => {
    mocks.v2.saveFundingRules.mockRejectedValue(
      new ApiRequestError(422, {
        type: 'about:blank',
        title: 'Unprocessable',
        status: 422,
        code: 'ENVELOPE_ARCHIVED',
        detail: 'Конверт архивирован.',
        fieldErrors: [{ field: 'queue.1.envelopeId', message: 'x', code: 'invalid' }],
      } as never),
    );
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-percent-b"]').setValue('11');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="rule-card-b"]').text()).toContain('Проверьте тип правила');
  });

  it('ошибка загрузки и повтор', async () => {
    mocks.v2.listFundingRules.mockRejectedValueOnce(new Error('boom'));
    const wrapper = await mountEditor();
    expect(wrapper.text()).toContain('Не удалось загрузить правила');
    await wrapper.find('[data-testid="rules-retry"]').trigger('click');
    await flushPromises();
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
  });
});
