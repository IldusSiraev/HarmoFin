import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    global: { stubs: { teleport: true } },
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

    expect(text).toContain('Осталось распределить');
    expect(text).toContain('80 000,00');
    expect(text).toContain('Принять лимит на период');
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

    expect((input.element as HTMLInputElement).value).toBe('10 000,50');
    expect(input.attributes('inputmode')).toBe('decimal');
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Сумма для Отпуск');
  });

  it('крупная сумма «Можно распределить» и пометка о счетах', () => {
    const wrapper = mountSheet();
    const text = norm(wrapper.text());

    expect(text).toContain('Можно распределить');
    expect(text).toContain('Деньги остаются на ваших счетах');
    expect(norm(wrapper.get('[data-testid="funding-source"]').text())).toMatch(/^80 000,00/);
  });

  it('подзаголовок называет источник денег', () => {
    expect(
      mountSheet({ sourceKind: 'INCOME' }).get('[data-testid="funding-subtitle"]').text(),
    ).toBe('Источник: доход');
    expect(mountSheet().find('[data-testid="funding-subtitle"]').exists()).toBe(false);
  });

  it('строка очереди: номер, иконка типа, причина и поле суммы с доступной подписью', () => {
    const wrapper = mountSheet({
      previewLines: [
        {
          envelopeId: ENV_A,
          periodId: null,
          suggestedMinor: '4000000',
          name: 'Обязательные платежи',
          envelopeType: 'MANDATORY_EXPENSES',
          queuePosition: 1,
        },
        { envelopeId: ENV_B, periodId: PERIOD, suggestedMinor: '1000050', name: 'Отпуск' },
      ],
    });
    const text = norm(wrapper.text());
    expect(text).toContain('Конверт');
    expect(text).toContain('Сумма');

    const [first, second] = wrapper.findAll('[data-testid="funding-line"]');
    expect(first?.get('.funding-sheet__line-number').text()).toBe('1');
    expect(first?.find('.envelope-type-icon--mandatory').exists()).toBe(true);
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe(
      'Сумма для Обязательные платежи',
    );
    // No type on the line: neutral custom icon, never a guess.
    expect(second?.find('.envelope-type-icon--custom').exists()).toBe(true);
  });

  it('пилюли подсказок видны под строкой, которая получила фокус', async () => {
    const wrapper = mountSheet();
    const actions = wrapper.get('[data-testid="funding-line"] .funding-sheet__line-actions');
    expect((actions.element as HTMLElement).style.display).toBe('none');

    await wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`).trigger('focusin');
    expect((actions.element as HTMLElement).style.display).toBe('');
  });

  it('нехватка на обязательные — warning-строка', () => {
    const wrapper = mountSheet({ mandatoryGapMinor: '400000' });
    const gap = wrapper.get('[data-testid="funding-gap"]');

    expect(gap.classes()).toContain('ui-attention-row--warning');
    expect(gap.text()).toContain('Можно распределить доступную сумму сейчас');
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

  it('keeps the two mandatory slice rows of one envelope distinct with lineId payloads', async () => {
    const lineA = `${ENV_A}||MANDATORY_CURRENT`;
    const lineB = `${ENV_A}||MANDATORY_NEXT`;
    const token = (id: string): string => id.replace(/[^A-Za-z0-9-]+/g, '-');
    const wrapper = mountSheet({
      previewLines: [
        {
          envelopeId: ENV_A,
          lineId: lineA,
          periodId: null,
          suggestedMinor: '4000000',
          name: 'Обязательные — текущий период',
        },
        {
          envelopeId: ENV_A,
          lineId: lineB,
          periodId: null,
          suggestedMinor: '1000050',
          name: 'Обязательные — следующий период',
        },
      ],
      mandatoryDueCurrentMinor: '4000000',
      mandatoryDueNextMinor: '1000050',
    });

    const inputA = wrapper.get(`[data-testid="funding-amount-${token(lineA)}"]`);
    const inputB = wrapper.get(`[data-testid="funding-amount-${token(lineB)}"]`);
    expect(wrapper.get(`label[for="${inputA.attributes('id')}"]`).text()).toBe(
      'Сумма для Обязательные — текущий период',
    );
    expect(wrapper.get(`label[for="${inputB.attributes('id')}"]`).text()).toBe(
      'Сумма для Обязательные — следующий период',
    );

    await inputA.setValue('5');
    await inputA.trigger('change');
    expect(wrapper.emitted('changeLine')?.[0]).toEqual([
      { envelopeId: ENV_A, lineId: lineA, amount: '5' },
    ]);

    expect(wrapper.get('[data-testid="funding-due-breakdown"]').text()).toContain('К оплате');
  });

  it('hides the due breakdown when both slices are zero or absent', () => {
    const zeros = mountSheet({ mandatoryDueCurrentMinor: '0', mandatoryDueNextMinor: '0' });
    expect(zeros.find('[data-testid="funding-due-breakdown"]').exists()).toBe(false);

    const absent = mountSheet();
    expect(absent.find('[data-testid="funding-due-breakdown"]').exists()).toBe(false);
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

    expect(intro).toContain('никуда не переводятся');
    expect(intro).toContain('Измените любую или впишите сумму в другой конверт');
  });

  it('says everything is proposed when nothing remains to assign', () => {
    const none = mountSheet({ remainingMinor: '0' });
    expect(none.get('[data-testid="funding-all-proposed"]').text()).toContain('Всё распределено');

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
      error: { code: 'OVERRIDES_EXCEED_SOURCE', detail: 'Распределено больше, чем доступно.' },
    });

    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Превышение');
    expect(wrapper.text()).toContain('500,00');
    expect(wrapper.text()).toContain('Распределено больше, чем доступно.');
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
      'Не хватает на обязательные платежи',
    );
    expect(norm(wrapper.get('[data-testid="funding-gap"]').text())).toContain('4 000,00');
  });

  it('announces the mandatory gap in the footer live region', () => {
    const wrapper = mountSheet({ mandatoryGapMinor: '400000' });
    const live = wrapper.get('[data-testid="funding-gap-live"]');

    expect(live.element.closest('[aria-live="polite"]')).not.toBeNull();
    expect(live.classes()).toContain('funding-sheet__sr');
    expect(norm(live.text())).toContain('Не хватает на обязательные платежи: 4 000,00');
    expect(wrapper.find('[data-testid="funding-gap"]').exists()).toBe(true);
  });

  it('has no gap echo when nothing is missing', () => {
    const wrapper = mountSheet({ mandatoryGapMinor: '0' });

    expect(wrapper.find('[data-testid="funding-gap-live"]').exists()).toBe(false);
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
    opener.textContent = 'Распределить';
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

  it('closes via later when the dialog asks to close', async () => {
    const wrapper = mountSheet();

    await wrapper.get('[data-testid="modal-close"]').trigger('click');

    expect(wrapper.emitted('later')).toHaveLength(1);
  });

  it('empty field means zero: emits 0, no error', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    await input.setValue('');
    await input.trigger('change');
    expect(wrapper.emitted('changeLine')?.[0]).toEqual([{ envelopeId: ENV_A, amount: '0' }]);
    expect(wrapper.find(`[data-testid="funding-line-error-${ENV_A}"]`).exists()).toBe(false);
  });

  it('a zero line renders an empty field with placeholder 0', () => {
    const wrapper = mountSheet({
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
    });
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(input.attributes('placeholder')).toBe('0');
  });

  it('re-previews after a typing pause, once', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountSheet();
      const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
      (input.element as HTMLInputElement).value = '12';
      await input.trigger('input');
      (input.element as HTMLInputElement).value = '120';
      await input.trigger('input');
      vi.advanceTimersByTime(399);
      expect(wrapper.emitted('changeLine')).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(wrapper.emitted('changeLine')).toEqual([[{ envelopeId: ENV_A, amount: '120' }]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the focused field while a new preview arrives', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    await input.trigger('focusin');
    await input.setValue('123');
    await wrapper.setProps({
      previewLines: [
        { envelopeId: ENV_A, periodId: null, suggestedMinor: '9900', name: 'Обязательные' },
        { envelopeId: ENV_B, periodId: PERIOD, suggestedMinor: '500', name: 'Отпуск' },
      ],
    });
    expect((input.element as HTMLInputElement).value).toBe('123');
    expect(
      (wrapper.get(`[data-testid="funding-amount-${ENV_B}"]`).element as HTMLInputElement).value,
    ).toBe('5');
  });

  it('fields stay editable while a preview is pending; confirm does not', () => {
    const wrapper = mountSheet({ pending: true });
    expect(
      wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`).attributes('disabled'),
    ).toBeUndefined();
    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('numbers only queued lines and shows period dates', () => {
    const wrapper = mountSheet({
      previewLines: [
        {
          envelopeId: ENV_A,
          periodId: null,
          suggestedMinor: '100',
          name: 'Обязательные',
          queuePosition: 1,
        },
        {
          envelopeId: ENV_B,
          periodId: PERIOD,
          suggestedMinor: '0',
          name: 'Второй период',
          queuePosition: null,
          periodStartsOn: '2026-10-25',
          periodEndsOn: '2026-11-09',
        },
      ],
    });
    const [first, second] = wrapper.findAll('[data-testid="funding-line"]');
    expect(first?.get('.funding-sheet__line-number').text()).toBe('1');
    expect(second?.find('.funding-sheet__line-number').text()).toBe('');
    expect(norm(second!.text())).toContain('25 окт. – 9 нояб.');
  });

  it('confirm is off when every line is zero and no period target is selected', () => {
    const wrapper = mountSheet({
      periodTargetDrafts: [],
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
      remainingMinor: '8000000',
    });
    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('explains why confirm is off when every line is zero and no period target is selected', () => {
    const wrapper = mountSheet({
      periodTargetDrafts: [],
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
      remainingMinor: '8000000',
    });
    expect(wrapper.get('[data-testid="funding-nothing"]').text()).toBe(
      'Впишите сумму хотя бы в один конверт или нажмите «Позже».',
    );

    const normal = mountSheet();
    expect(normal.find('[data-testid="funding-nothing"]').exists()).toBe(false);
  });

  it('does not claim everything is proposed when nothing was actually assigned', () => {
    const wrapper = mountSheet({
      periodTargetDrafts: [],
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
      remainingMinor: '0',
    });
    expect(wrapper.find('[data-testid="funding-all-proposed"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="funding-nothing"]').text()).toBe(
      'Впишите сумму хотя бы в один конверт или нажмите «Позже».',
    );
  });

  it('labels the primary action «Распределить» and explains editing any envelope', () => {
    const wrapper = mountSheet();
    expect(wrapper.get('[data-testid="funding-confirm"]').text()).toBe('Распределить');
    expect(norm(wrapper.get('[data-testid="funding-intro"]').text())).toContain(
      'Измените любую или впишите сумму в другой конверт',
    );
  });
});
