import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => {
  return {
    auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
    api: { getBudget: vi.fn(), updateBudget: vi.fn() },
    planV2: {
      previewCycleChange: vi.fn(),
      confirmCycleChange: vi.fn(),
      updateBudgetSettings: vi.fn(),
    },
  };
});
vi.mock('../../../composables/useEnvelopePlanV2.js', () => ({
  useEnvelopePlanV2: () => mocks.planV2,
}));

vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.api,
}));

import GeneralSettingsPage from './general.vue';

const budget = {
  id: 'budget-id',
  workspaceId: 'workspace-id',
  name: 'Семейный бюджет',
  primaryCurrency: 'RUB',
  timezone: 'Europe/Moscow',
  cycleStartDay: 10,
  periodBoundaryOffset: 15,
  allowNegativeBalance: false,
  incomeAllocationRuleEnabled: false,
  incomeAllocationSourceCategoryId: null,
  incomeAllocationTargetEnvelopeId: null,
  status: 'ACTIVE' as const,
};

function mountPage() {
  return mount(GeneralSettingsPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings general page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = {
      user: { id: 'user-id', email: 'owner@example.test', displayName: null },
      workspaces: [
        {
          id: 'workspace-id',
          name: 'Семья',
          role: 'OWNER',
          budgets: [
            {
              id: 'budget-id',
              name: 'Семейный бюджет',
              primaryCurrency: 'RUB',
              planModelVersion: 2,
            },
          ],
        },
      ],
    };
    mocks.auth.loadMe.mockResolvedValue(mocks.auth.currentData.value);
    mocks.api.getBudget.mockResolvedValue(budget);
  });

  it('saves only the changed settings through the settings endpoint', async () => {
    mocks.planV2.updateBudgetSettings.mockResolvedValue(budget);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[name="name"]').setValue('Новое имя');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.planV2.updateBudgetSettings).toHaveBeenCalledWith(
      'budget-id',
      { name: 'Новое имя' },
      expect.any(String),
    );
    expect(mocks.api.updateBudget).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Общие настройки сохранены.');
  });

  it('shows a Russian error and marks the timezone field when a timezone change is blocked', async () => {
    mocks.planV2.updateBudgetSettings.mockRejectedValue(
      new ApiRequestError(409, {
        code: 'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION',
        detail: 'technical',
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[name="name"]').setValue('Другое имя');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="summary-status"]').text()).not.toContain('technical');
    expect(wrapper.get('[name="timezone"]').attributes('aria-invalid')).toBe('true');
  });

  describe('budget model v2 cycle change', () => {
    const preview = {
      effectiveOn: '2026-11-12',
      transitionRanges: [{ start: '2026-10-01', end: '2026-11-11' }],
      previewHash: 'a'.repeat(64),
    };
    const confirmed = {
      effectiveOn: '2026-12-05',
      baselineCreated: true,
      transitionRanges: preview.transitionRanges,
      createdPeriods: 1,
    };

    function problem(status: number, code: string) {
      return new ApiRequestError(status, { code, detail: 'technical' });
    }

    async function openPreview(wrapper: ReturnType<typeof mountPage>) {
      await wrapper.get('[name="cycleStartDay"]').setValue('12');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
    }

    function confirmButton(wrapper: ReturnType<typeof mountPage>) {
      return wrapper.get('[data-action="confirm-cycle-change"]');
    }

    beforeEach(() => {
      mocks.planV2.previewCycleChange.mockResolvedValue(preview);
      mocks.planV2.confirmCycleChange.mockResolvedValue(confirmed);
      mocks.planV2.updateBudgetSettings.mockResolvedValue({ ...budget, planModelVersion: 2 });
    });

    it('previews the future action without writing settings or confirming', async () => {
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);

      expect(mocks.planV2.previewCycleChange).toHaveBeenCalledWith('budget-id', {
        cycleStartDay: 12,
        periodBoundaryOffset: 15,
      });
      expect(wrapper.text()).toContain('Действует с');
      expect(wrapper.text()).toContain('12.11.2026');
      expect(wrapper.text()).toContain('Прошлые периоды остаются без изменений');
      expect(mocks.planV2.confirmCycleChange).not.toHaveBeenCalled();
      expect(mocks.planV2.updateBudgetSettings).not.toHaveBeenCalled();
      expect(mocks.api.updateBudget).not.toHaveBeenCalled();
    });

    it('requires a target or "no fixed target" for a shortened transition', async () => {
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);

      expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();
      await wrapper.get('input[name="transitionTarget-2026-10-01"]').setValue('abc');
      expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();
      expect(wrapper.text()).toContain('Введите сумму');

      await wrapper.get('input[name="transitionTarget-2026-10-01"]').setValue('1500.50');
      expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined();
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      expect(mocks.planV2.confirmCycleChange).toHaveBeenCalledWith(
        'budget-id',
        {
          cycleStartDay: 12,
          periodBoundaryOffset: 15,
          previewHash: preview.previewHash,
          transitionTargets: [{ periodStart: '2026-10-01', target: '1500.50' }],
        },
        expect.any(String),
      );
    });

    it('sends a null target for "no fixed target" and takes the date from the API response', async () => {
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      expect(mocks.planV2.confirmCycleChange.mock.calls[0]![1].transitionTargets).toEqual([
        { periodStart: '2026-10-01', target: null },
      ]);
      expect(wrapper.text()).toContain('05.12.2026');
      expect(mocks.api.getBudget).toHaveBeenCalledTimes(2);
      expect(mocks.planV2.confirmCycleChange).toHaveBeenCalledTimes(1);
    });

    it('guards double submit with a single confirm call', async () => {
      let release: (value: unknown) => void = () => undefined;
      mocks.planV2.confirmCycleChange.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await confirmButton(wrapper).trigger('click');
      expect(mocks.planV2.confirmCycleChange).toHaveBeenCalledTimes(1);
      release(confirmed);
      await flushPromises();
    });

    it('reuses the Idempotency-Key on retry and rotates it when the target changes', async () => {
      mocks.planV2.confirmCycleChange
        .mockRejectedValueOnce(problem(500, 'INTERNAL'))
        .mockRejectedValueOnce(problem(500, 'INTERNAL'))
        .mockRejectedValueOnce(problem(500, 'INTERNAL'));
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      const [first, second] = mocks.planV2.confirmCycleChange.mock.calls;
      expect(second![2]).toBe(first![2]);

      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(false);
      await wrapper.get('input[name="transitionTarget-2026-10-01"]').setValue('10');
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      expect(mocks.planV2.confirmCycleChange.mock.calls[2]![2]).not.toBe(first![2]);
    });

    it('offers "Обновить" on PREVIEW_STALE and requests a new preview', async () => {
      mocks.planV2.confirmCycleChange.mockRejectedValueOnce(problem(409, 'PREVIEW_STALE'));
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Данные изменились');
      await wrapper.get('[data-action="refresh-cycle-preview"]').trigger('click');
      await flushPromises();
      expect(mocks.planV2.previewCycleChange).toHaveBeenCalledTimes(2);
    });

    it('explains the timezone restriction without retrying or rewriting history', async () => {
      mocks.planV2.updateBudgetSettings.mockRejectedValue(
        problem(409, 'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION'),
      );
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'UiSelect' }).vm.$emit('update:modelValue', 'Asia/Tokyo');
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Часовой пояс нельзя менять после подтверждённых операций');
      expect(mocks.planV2.updateBudgetSettings).toHaveBeenCalledTimes(1);
      expect(mocks.planV2.confirmCycleChange).not.toHaveBeenCalled();
    });

    it('changes the timezone in an empty budget without a cycle preview block', async () => {
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'UiSelect' }).vm.$emit('update:modelValue', 'Asia/Tokyo');
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(mocks.planV2.updateBudgetSettings).toHaveBeenCalledWith(
        'budget-id',
        { timezone: 'Asia/Tokyo' },
        expect.any(String),
      );
      expect(mocks.planV2.previewCycleChange).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('Действует с');
      expect(wrapper.text()).toContain('Общие настройки сохранены.');
    });

    it('shows a preview failure as an error, not as success', async () => {
      mocks.planV2.previewCycleChange.mockRejectedValue(problem(500, 'INTERNAL'));
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);

      const status = wrapper.get('[data-testid="summary-status"] .ui-status');
      expect(status.classes()).toContain('ui-status--danger');
      expect(wrapper.text()).not.toContain('Общие настройки сохранены.');
    });

    it('moves focus to the status and links the disabled reason to the confirm button', async () => {
      mocks.planV2.confirmCycleChange.mockRejectedValueOnce(problem(500, 'INTERNAL'));
      const wrapper = mount(GeneralSettingsPage, {
        attachTo: document.body,
        global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
      });
      await flushPromises();
      await openPreview(wrapper);
      expect(confirmButton(wrapper).attributes('aria-describedby')).toBe('cycle-confirm-hint');
      expect(wrapper.find('#cycle-confirm-hint').exists()).toBe(true);

      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[data-testid="summary-status"]').element);
      wrapper.unmount();
    });

    it.each([
      [409, 'CYCLE_CHANGE_PENDING', 'Предыдущая смена цикла'],
      [422, 'CYCLE_SETTINGS_UNCHANGED', 'уже действуют'],
    ])('explains %i %s without a refresh action', async (status, code, text) => {
      mocks.planV2.previewCycleChange.mockRejectedValue(problem(status, code));
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);

      expect(wrapper.text()).toContain(text);
      expect(wrapper.find('[data-action="refresh-cycle-preview"]').exists()).toBe(false);
    });

    it('applies settings before the cycle and does not confirm when the timezone is blocked', async () => {
      mocks.planV2.updateBudgetSettings.mockRejectedValue(
        problem(409, 'TIMEZONE_CHANGE_REQUIRES_RECONCILIATION'),
      );
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'UiSelect' }).vm.$emit('update:modelValue', 'Asia/Tokyo');
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Часовой пояс нельзя менять после подтверждённых операций');
      expect(mocks.planV2.confirmCycleChange).not.toHaveBeenCalled();
      expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('does not repeat the settings PATCH when only the cycle confirm is retried', async () => {
      mocks.planV2.confirmCycleChange.mockRejectedValueOnce(problem(500, 'INTERNAL'));
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'UiSelect' }).vm.$emit('update:modelValue', 'Asia/Tokyo');
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      expect(mocks.planV2.updateBudgetSettings).toHaveBeenCalledTimes(1);
      expect(mocks.planV2.confirmCycleChange).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Действует с 05.12.2026');
    });

    it('resets the attempt after "Обновить": new hash, new key, decisions cleared', async () => {
      const fresh = { ...preview, previewHash: 'b'.repeat(64) };
      mocks.planV2.previewCycleChange.mockResolvedValueOnce(preview).mockResolvedValueOnce(fresh);
      mocks.planV2.confirmCycleChange.mockRejectedValueOnce(problem(409, 'PREVIEW_STALE'));
      const wrapper = mountPage();
      await flushPromises();
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      await wrapper.get('[data-action="refresh-cycle-preview"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-action="refresh-cycle-preview"]').exists()).toBe(false);
      expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      const [first, second] = mocks.planV2.confirmCycleChange.mock.calls;
      expect(second![1].previewHash).toBe('b'.repeat(64));
      expect(second![2]).not.toBe(first![2]);
    });

    it('does not repeat the applied settings PATCH after PREVIEW_STALE and refresh', async () => {
      mocks.planV2.confirmCycleChange.mockRejectedValueOnce(problem(409, 'PREVIEW_STALE'));
      const wrapper = mountPage();
      await flushPromises();
      wrapper.findComponent({ name: 'UiSelect' }).vm.$emit('update:modelValue', 'Asia/Tokyo');
      await openPreview(wrapper);
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();
      await wrapper.get('[data-action="refresh-cycle-preview"]').trigger('click');
      await flushPromises();
      await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
      await confirmButton(wrapper).trigger('click');
      await flushPromises();

      expect(mocks.planV2.updateBudgetSettings).toHaveBeenCalledTimes(1);
      expect(mocks.planV2.confirmCycleChange).toHaveBeenCalledTimes(2);
    });
  });
});
