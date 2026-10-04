import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import FundingReviewSheet from './FundingReviewSheet.vue';

const ENV_A = '11111111-1111-4111-8111-111111111111';
const ENV_B = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    sourceMinor: '8000000',
    periodTargetDrafts: [
      { periodId: PERIOD, targetMinor: '6500000', selectedForConfirmation: true },
    ],
    previewLines: [
      {
        envelopeId: ENV_A,
        periodId: null,
        suggestedMinor: '4000000',
        name: 'Обязательные',
        toTargetMinor: '4500000',
        allRemainingMinor: '8000000',
      },
      { envelopeId: ENV_B, periodId: PERIOD, suggestedMinor: '1000050', name: 'Отпуск' },
    ],
    remainingMinor: '2999950',
    mandatoryGapMinor: '0',
    pending: false,
    error: null,
    ...overrides,
  };
}

const norm = (value: string): string => value.replace(/\s/g, ' ');

const wrappers: Array<{ unmount: () => void }> = [];
function mountSheet(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(FundingReviewSheet, {
    props: baseProps(overrides),
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('FundingReviewSheet', () => {
  it('shows the source amount, remaining, period target and row actions', () => {
    const text = norm(mountSheet().text());

    expect(text).toContain('Осталось назначить');
    expect(text).toContain('80 000,00');
    expect(text).toContain('Принять план периода');
    expect(text).toContain('65 000,00');
    expect(text).toContain('До нужной суммы');
    expect(text).toContain('Весь остаток');
    expect(text).toContain('Оставить свободными');
    expect(text).toContain('Позже');
  });

  it('keeps lines in the order the server sent them', () => {
    const wrapper = mountSheet();
    const rows = wrapper.findAll('[data-testid="funding-line"]');

    expect(rows.map((row) => row.attributes('data-envelope-id'))).toEqual([ENV_A, ENV_B]);
    expect(rows[0]?.text()).toContain('Обязательные');
  });

  it('renders amounts as decimal text with an accessible label', () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_B}"]`);

    expect((input.element as HTMLInputElement).value).toBe('10000.50');
    expect(input.attributes('inputmode')).toBe('decimal');
    expect(input.attributes('aria-label')).toBe('Сумма для конверта Отпуск');
  });

  it('shows the period target selected by default and toggles it', async () => {
    const wrapper = mountSheet();
    const toggle = wrapper.get('[data-testid="funding-period-toggle"]');

    expect((toggle.element as HTMLInputElement).checked).toBe(true);
    await toggle.setValue(false);
    expect(wrapper.emitted('togglePeriodTarget')?.[0]).toEqual([
      { periodId: PERIOD, selected: false },
    ]);
  });

  it('emits changeLine with a decimal amount on change', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);

    await input.setValue('1500,5');
    await input.trigger('change');

    expect(wrapper.emitted('changeLine')?.[0]).toEqual([{ envelopeId: ENV_A, amount: '1500.5' }]);
  });

  it('includes periodId for period lines', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_B}"]`);

    await input.setValue('20');
    await input.trigger('change');

    expect(wrapper.emitted('changeLine')?.[0]).toEqual([
      { envelopeId: ENV_B, periodId: PERIOD, amount: '20' },
    ]);
  });

  it('rejects malformed input next to the field without emitting', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);

    await input.setValue('12.345');
    await input.trigger('change');

    expect(wrapper.emitted('changeLine')).toBeUndefined();
    const error = wrapper.get(`[data-testid="funding-line-error-${ENV_A}"]`);
    expect(error.text()).toContain('не более двух знаков');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe(error.attributes('id'));
  });

  it('shows a server field error next to the line', () => {
    const wrapper = mountSheet({
      previewLines: [
        {
          envelopeId: ENV_A,
          periodId: null,
          suggestedMinor: '0',
          name: 'Обязательные',
          error: 'Слишком много',
        },
      ],
    });

    expect(wrapper.get(`[data-testid="funding-line-error-${ENV_A}"]`).text()).toBe('Слишком много');

    const error = wrapper.get(`[data-testid="funding-line-error-${ENV_A}"]`);
    expect(error.find('svg[aria-hidden="true"]').exists()).toBe(true);
    expect(wrapper.get(`[data-testid="funding-confirm"]`).attributes('disabled')).toBeDefined();
  });

  it('emits hint amounts from the DTO for row shortcuts, never computed', async () => {
    const wrapper = mountSheet();

    await wrapper.get(`[data-testid="funding-to-target-${ENV_A}"]`).trigger('click');
    await wrapper.get(`[data-testid="funding-all-remaining-${ENV_A}"]`).trigger('click');

    expect(wrapper.emitted('changeLine')).toEqual([
      [{ envelopeId: ENV_A, amount: '45000.00' }],
      [{ envelopeId: ENV_A, amount: '80000.00' }],
    ]);
    // No server hint for this line: no dead buttons.
    expect(wrapper.find(`[data-testid="funding-to-target-${ENV_B}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-testid="funding-all-remaining-${ENV_B}"]`).exists()).toBe(false);
  });

  it('explains that the proposal is ready and nothing moves between accounts', () => {
    const wrapper = mountSheet();
    const intro = norm(wrapper.get('[data-testid="funding-intro"]').text());

    expect(intro).toContain('пока свободны');
    expect(intro).toContain('никуда не переводятся');
    expect(intro).toContain('Назначить предложенное');
    expect(intro).toContain('Позже');
  });

  it('says everything is proposed when nothing remains to assign', () => {
    const none = mountSheet({ remainingMinor: '0' });
    expect(none.get('[data-testid="funding-all-proposed"]').text()).toContain('Всё предложено');

    const some = mountSheet();
    expect(some.find('[data-testid="funding-all-proposed"]').exists()).toBe(false);

    // Nothing was proposed at all (e.g. the free money vanished): no false claim.
    const empty = mountSheet({ remainingMinor: '0', previewLines: [] });
    expect(empty.find('[data-testid="funding-all-proposed"]').exists()).toBe(false);
  });

  it('disables confirm while pending', async () => {
    const wrapper = mountSheet({ pending: true });

    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="funding-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('disables confirm and states the excess in words on OVERRIDES_EXCEED_SOURCE', async () => {
    const wrapper = mountSheet({
      remainingMinor: '-50000',
      error: { code: 'OVERRIDES_EXCEED_SOURCE', detail: 'Назначено больше, чем доступно.' },
    });

    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Превышение');
    expect(wrapper.text()).toContain('500,00');
    expect(wrapper.text()).toContain('Назначено больше, чем доступно.');
    await wrapper.get('[data-testid="funding-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('disables confirm on excess alone, without any API error', async () => {
    const wrapper = mountSheet({ remainingMinor: '-100', error: null });

    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="funding-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('disables confirm while a typed amount is invalid', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);

    await input.setValue('abc');
    await input.trigger('change');

    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="funding-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('renders a server error as one alert with an icon and text', () => {
    const wrapper = mountSheet({ error: { code: 'OTHER', detail: 'Что-то пошло не так.' } });
    const alert = wrapper.get('[data-testid="funding-error"]');

    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toContain('Что-то пошло не так.');
    expect(alert.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('enables confirm for a clean preview and emits confirm / later', async () => {
    const wrapper = mountSheet();
    const confirm = wrapper.get('[data-testid="funding-confirm"]');

    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    await wrapper.get('[data-testid="funding-later"]').trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('later')).toHaveLength(1);
  });

  it('explains the mandatory gap in text', () => {
    const wrapper = mountSheet({ mandatoryGapMinor: '400000' });

    expect(wrapper.get('[data-testid="funding-gap"]').text()).toContain(
      'Не хватает на обязательства',
    );
    expect(norm(wrapper.get('[data-testid="funding-gap"]').text())).toContain('4 000,00');
  });

  it('offers refresh on PREVIEW_STALE and never confirms the stale amount', async () => {
    const wrapper = mountSheet({
      error: { code: 'PREVIEW_STALE', detail: 'Данные изменились.' },
    });

    expect(wrapper.get('[data-testid="funding-stale"]').text()).toContain('Обновить');
    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="funding-confirm"]').trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();

    await wrapper.get('[data-testid="funding-refresh"]').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });

  it('moves focus into the dialog on open and back to the opener on close', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Назначить';
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = mountSheet({ open: false });
    await wrapper.setProps({ open: true });
    await nextTick();
    await nextTick();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);

    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
  });

  it('closes via later when the drawer asks to close', async () => {
    const wrapper = mountSheet();

    await wrapper.get('[data-testid="drawer-close"]').trigger('click');

    expect(wrapper.emitted('later')).toHaveLength(1);
  });
});
